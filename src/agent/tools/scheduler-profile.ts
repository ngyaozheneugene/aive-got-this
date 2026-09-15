import { proposeOutputSchema } from '../../shared/contracts/propose';
import type { ProposeInput, ProposeOutput } from '../../shared/types/domain';
import { MAX_CANDIDATES_PER_PROFILE } from '../playbooks/urgent';
import { AgentError } from '../runtime/errors';

/**
 * Main currently returns BOTH profiles per propose() call. The graph requests
 * each profile explicitly. Validate the entire batch before selecting that
 * profile: this is transport adaptation, never re-ranking or metric repair.
 * A future scheduler returning only the requested profile also works unchanged.
 */
export function selectRequestedProfile(input: ProposeInput, raw: unknown): ProposeOutput {
  const parsed = proposeOutputSchema.safeParse(raw);
  if (!parsed.success) throw new AgentError('INVALID_SCHEDULER_RESULT');
  const output = parsed.data;
  if (output.engine === 'stub' || output.message === 'not_implemented') {
    throw new AgentError('SCHEDULER_NOT_IMPLEMENTED');
  }
  const seen = new Set<string>();
  const counts = { sla_first: 0, minimal_disruption: 0 };
  for (const plan of output.plans) {
    if (!plan.id || !plan.proposalId || seen.has(plan.id)) {
      throw new AgentError('INVALID_CANDIDATE_ID');
    }
    if (plan.sourceSnapshotId !== input.schedule.snapshotId) {
      throw new AgentError('CANDIDATE_CONTEXT_MISMATCH');
    }
    seen.add(plan.id);
    counts[plan.profile] += 1;
    if (counts[plan.profile] > MAX_CANDIDATES_PER_PROFILE) {
      throw new AgentError('TOO_MANY_CANDIDATES');
    }
  }
  const plans = output.plans.filter((plan) => plan.profile === input.profile);
  if (output.plans.length > 0 && plans.length === 0) {
    // Do not misreport a broken profile response as a proven infeasible event.
    throw new AgentError('SCHEDULER_PROFILE_MISSING');
  }
  return { ...output, plans };
}
