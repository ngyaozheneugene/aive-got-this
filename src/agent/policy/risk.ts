import { RISK_POLICY } from '../../shared/config/reason-codes';
import { emptyPlanMetrics } from '../../shared/types/domain';
import type {
  Assignment,
  AutonomyMode,
  CandidatePlan,
  RiskLevel,
} from '../../shared/types/domain';

/** Backend-owned classification reasons. The model does not invent these. */
export const RISK_REASONS = [
  'infeasible',
  'validation_failed',
  'missing_or_expired_cert',
  'excessive_overtime',
  'incomplete_assignment',
  'reassignment',
  'window_moved',
  'new_assignment',
  'overtime',
  'jobs_moved',
  'unassigned_jobs',
  'cancellation',
] as const;

export type RiskReason = (typeof RISK_REASONS)[number];

export interface RiskClassification {
  risk: RiskLevel;
  autonomyMode: AutonomyMode;
  reasons: RiskReason[];
}

export interface RiskInput {
  plans: readonly CandidatePlan[];
  liveAssignments: readonly Pick<
    Assignment,
    'jobId' | 'technicianId' | 'status' | 'windowStart' | 'windowEnd'
  >[];
}

const HIGH_REASONS: ReadonlySet<RiskReason> = new Set([
  'infeasible',
  'validation_failed',
  'missing_or_expired_cert',
  'excessive_overtime',
  'incomplete_assignment',
]);

const LIVE_ASSIGNMENT: ReadonlySet<Assignment['status']> = new Set(['accepted', 'offered']);

export function modeForRisk(risk: RiskLevel): AutonomyMode {
  return RISK_POLICY[risk];
}

/**
 * Code-owned AUTO / APPROVAL / BLOCK. Fail closed: unknown or incomplete evidence
 * cannot produce a weaker mode than the triggers on the stored plans.
 */
export function classifyProposalRisk(input: RiskInput): RiskClassification {
  const reasons = new Set<RiskReason>();
  if (input.plans.length === 0) reasons.add('infeasible');

  const live = new Map<string, { technicianId: string; windowStart?: string; windowEnd?: string }>();
  for (const row of input.liveAssignments) {
    if (!LIVE_ASSIGNMENT.has(row.status)) continue;
    live.set(row.jobId, {
      technicianId: row.technicianId,
      windowStart: row.windowStart,
      windowEnd: row.windowEnd,
    });
  }

  for (const plan of input.plans) {
    const metrics = plan.metrics ?? emptyPlanMetrics();
    const violations = plan.validations?.violations ?? [];
    if (plan.status === 'REJECTED' || plan.validations?.ok === false || violations.length > 0) {
      reasons.add('validation_failed');
    }
    if (violations.some((code) => code.startsWith('MISSING_CERT') || code.startsWith('CERT_EXPIRED'))) {
      reasons.add('missing_or_expired_cert');
    }
    if (violations.some((code) => code.startsWith('EXCESSIVE_OVERTIME'))) {
      reasons.add('excessive_overtime');
    }
    if (metrics.overtimeMinutes > 0) reasons.add('overtime');
    if (metrics.jobsMoved > 0) reasons.add('jobs_moved');

    const plannedJobs = new Set<string>();
    for (const slot of plan.assignments ?? []) {
      if (slot.jobId) plannedJobs.add(slot.jobId);
      if (!slot.jobId || !slot.technicianId) {
        reasons.add('incomplete_assignment');
        continue;
      }
      const current = live.get(slot.jobId);
      if (!current) {
        reasons.add('new_assignment');
        continue;
      }
      if (current.technicianId !== slot.technicianId) reasons.add('reassignment');
      if ((current.windowStart ?? '') !== (slot.windowStart ?? '')
        || (current.windowEnd ?? '') !== (slot.windowEnd ?? '')) {
        reasons.add('window_moved');
      }
    }
    for (const [jobId] of live) {
      if (!plannedJobs.has(jobId)) reasons.add('jobs_moved');
    }
    for (const change of plan.changeSet ?? []) {
      const action = typeof change.action === 'string' ? change.action : '';
      if (action === 'reassign') reasons.add('reassignment');
      if (action === 'assign') reasons.add('new_assignment');
      // Partial coverage: a customer loses their booking until someone calls.
      if (action === 'unassign') reasons.add('unassigned_jobs');
      // A customer's booking comes off the board (ADR 015): a person signs that off.
      if (action === 'cancel') reasons.add('cancellation');
    }
  }

  const ordered = RISK_REASONS.filter((reason) => reasons.has(reason));
  const risk: RiskLevel = ordered.some((reason) => HIGH_REASONS.has(reason))
    ? 'high'
    : ordered.length > 0
      ? 'medium'
      : 'low';
  return { risk, autonomyMode: modeForRisk(risk), reasons: ordered };
}
