import { emptyPlanMetrics } from '../../shared/types/domain';
import type { CandidatePlan, PlanMetrics, PlanProfile } from '../../shared/types/domain';

export interface PlanComparison {
  comparisonReady: boolean;
  profiles: PlanProfile[];
  metrics: Partial<Record<PlanProfile, PlanMetrics>>;
  deltas: Partial<Record<keyof PlanMetrics, number>>;
  reasons: string[];
}

function assignmentSignature(plan: CandidatePlan): string {
  return [...plan.assignments]
    .map((slot) => [slot.jobId, slot.technicianId, slot.windowStart ?? '', slot.windowEnd ?? ''].join('\t'))
    .sort()
    .join('\n');
}

/** Backend-owned comparison. Never ranks in a prompt or invents metrics. */
export function compareCandidatePlans(plans: readonly CandidatePlan[]): PlanComparison {
  const accepted = plans.filter((plan) =>
    plan.validations.ok && plan.validations.violations.length === 0 && plan.status !== 'REJECTED');
  const metrics: Partial<Record<PlanProfile, PlanMetrics>> = {};
  const byProfile = new Map<PlanProfile, CandidatePlan>();
  for (const plan of accepted) {
    metrics[plan.profile] = plan.metrics ?? emptyPlanMetrics();
    byProfile.set(plan.profile, plan);
  }
  const profiles = (['sla_first', 'minimal_disruption'] as const)
    .filter((profile) => metrics[profile]);
  const sla = metrics.sla_first;
  const quiet = metrics.minimal_disruption;
  const deltas: PlanComparison['deltas'] = {};
  const reasons: string[] = [];
  const slaPlan = byProfile.get('sla_first');
  const quietPlan = byProfile.get('minimal_disruption');
  const sameAssignments = Boolean(
    slaPlan && quietPlan && assignmentSignature(slaPlan) === assignmentSignature(quietPlan),
  );
  if (sla && quiet && !sameAssignments) {
    (Object.keys(emptyPlanMetrics()) as (keyof PlanMetrics)[]).forEach((key) => {
      deltas[key] = sla[key] - quiet[key];
    });
    reasons.push('stored_metrics_only');
  } else if (sameAssignments) {
    reasons.push('identical_plans');
  } else {
    reasons.push('single_profile');
  }
  return {
    comparisonReady: profiles.length === 2 && !sameAssignments,
    profiles, metrics, deltas, reasons,
  };
}
