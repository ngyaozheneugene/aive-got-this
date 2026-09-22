import type { CandidatePlan } from '../../shared/types/domain';
import { planValidationSchema, proposeOutputSchema } from '../../shared/contracts/propose';
import { SOLVER_TIMEOUT_MS } from '../../shared/config/timeouts';
import { allowedUrgentCalls, MAX_CANDIDATES_PER_PROFILE, validatedCandidates } from '../playbooks/urgent';
import type { AgentTraceStep, UrgentProgress, UrgentStatus } from '../playbooks/urgent';
import type { UrgentToolCall } from '../tools/protocol';
import type { UrgentTools } from '../tools/urgent';
import { planningContextFingerprint } from '../tools/context-fingerprint';
import { bounded } from './bounds';
import { AgentError } from './errors';

export async function applyRecoveryTool(input: {
  eventId: string;
  progress: UrgentProgress;
  request: UrgentToolCall;
  tools: UrgentTools;
  signal?: AbortSignal;
}): Promise<{ progress: UrgentProgress; result: Record<string, unknown>; status: UrgentStatus }> {
  const expected = input.progress.context?.schedule.snapshotId;
  const context = await bounded(() => input.tools.readContext(input.eventId, expected), SOLVER_TIMEOUT_MS, input.signal);
  if (context.event.id !== input.eventId || (expected && context.schedule.snapshotId !== expected)) {
    throw new AgentError('STALE_SNAPSHOT');
  }
  if (input.progress.context && JSON.stringify(context.event.normalizedPayload) !==
      JSON.stringify(input.progress.context.event.normalizedPayload)) throw new AgentError('EVENT_CHANGED');
  if (input.progress.context && planningContextFingerprint(context) !==
      planningContextFingerprint(input.progress.context)) throw new AgentError('PLANNING_CONTEXT_CHANGED');
  const progress: UrgentProgress = { ...input.progress, context };
  let result: Record<string, unknown>;

  if (input.request.tool === 'retrieve_board') {
    result = { eventId: context.event.id, sourceSnapshotId: context.schedule.snapshotId,
      eventType: context.event.type, jobs: context.schedule.jobs.length,
      technicians: context.schedule.technicians.length };
  } else if (input.request.tool === 'propose') {
    const profile = input.request.args.profile;
    const raw = await bounded(() => input.tools.propose({ event: context.event,
      schedule: context.schedule, profile }), SOLVER_TIMEOUT_MS, input.signal);
    const parsed = proposeOutputSchema.safeParse(raw);
    if (!parsed.success) throw new AgentError('INVALID_SCHEDULER_RESULT');
    const output = parsed.data;
    if (output.engine === 'stub' || output.message === 'not_implemented') throw new AgentError('SCHEDULER_NOT_IMPLEMENTED');
    if (output.plans.length > MAX_CANDIDATES_PER_PROFILE) throw new AgentError('TOO_MANY_CANDIDATES');
    const seen = new Set(progress.candidates.map((plan) => plan.id));
    for (const plan of output.plans) {
      if (!plan.id || !plan.proposalId || seen.has(plan.id)) throw new AgentError('INVALID_CANDIDATE_ID');
      if (plan.sourceSnapshotId !== context.schedule.snapshotId || plan.profile !== profile) {
        throw new AgentError('CANDIDATE_CONTEXT_MISMATCH');
      }
      seen.add(plan.id);
    }
    progress.proposedProfiles = [...progress.proposedProfiles, profile];
    progress.candidates = [...progress.candidates, ...structuredClone(output.plans)];
    result = { profile, engine: output.engine, timedOut: output.timedOut, planIds: output.plans.map((plan) => plan.id) };
  } else {
    const planId = input.request.args.planId;
    const plan = progress.candidates.find((candidate) => candidate.id === planId);
    if (!plan) throw new AgentError('UNKNOWN_CANDIDATE');
    const raw = await bounded(() => input.tools.validate(structuredClone(plan), context.schedule),
      SOLVER_TIMEOUT_MS, input.signal);
    const parsed = planValidationSchema.safeParse(raw);
    if (!parsed.success) throw new AgentError('INVALID_VALIDATOR_RESULT');
    const violations = [...new Set([...plan.validations.violations, ...parsed.data.violations])];
    const ok = plan.status !== 'REJECTED' && plan.validations.ok && parsed.data.ok && violations.length === 0;
    const checked: CandidatePlan = { ...plan, validations: { ok, violations }, status: ok ? 'VALIDATED' : 'REJECTED' };
    progress.candidates = progress.candidates.map((candidate) => candidate.id === plan.id ? checked : candidate);
    progress.validatedPlanIds = [...progress.validatedPlanIds, plan.id];
    result = { planId: plan.id, ok, violations };
  }

  let status: UrgentStatus = 'running';
  if (!allowedUrgentCalls(progress).length) {
    const fresh = await bounded(() => input.tools.readContext(input.eventId, context.schedule.snapshotId),
      SOLVER_TIMEOUT_MS, input.signal);
    if (fresh.schedule.snapshotId !== context.schedule.snapshotId) throw new AgentError('STALE_SNAPSHOT');
    if (planningContextFingerprint(fresh) !== planningContextFingerprint(context)) {
      throw new AgentError('PLANNING_CONTEXT_CHANGED');
    }
    status = validatedCandidates(progress).length ? 'candidates_ready' : 'no_candidates';
  }
  return { progress, result, status };
}

export function recoveryTrace(
  sequence: number, request: UrgentToolCall | undefined, result: Record<string, unknown>,
  durationMs: number, outcome: AgentTraceStep['outcome'],
): AgentTraceStep {
  return { sequence, tool: request?.tool ?? 'supervisor', args: request?.args ?? {}, result, durationMs, outcome };
}
