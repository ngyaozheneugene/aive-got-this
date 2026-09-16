import type { CandidatePlan, PlanProfile } from '../../shared/types/domain';
import type { UrgentToolCall } from '../tools/protocol';
import type { PlanningContext } from '../tools/urgent';

export const URGENT_PROFILES: readonly PlanProfile[] = ['sla_first', 'minimal_disruption'];
export const MAX_CANDIDATES_PER_PROFILE = 4;
export type UrgentStatus = 'running' | 'candidates_ready' | 'no_candidates' | 'failed' | 'blocked_dependency' | 'superseded';
export interface AgentTraceStep {
  sequence: number;
  tool: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  durationMs: number;
  outcome: 'ok' | 'error';
}
export interface UrgentProgress {
  eventId: string;
  context?: PlanningContext;
  proposedProfiles: PlanProfile[];
  candidates: CandidatePlan[];
  validatedPlanIds: string[];
}

/** Code supplies the legal frontier. The model chooses the next named tool. */
export function allowedUrgentCalls(state: UrgentProgress): UrgentToolCall[] {
  if (!state.context) return [{ tool: 'retrieve_board', args: {} }];
  const pendingProfiles = URGENT_PROFILES.filter((profile) => !state.proposedProfiles.includes(profile));
  if (pendingProfiles.length) return pendingProfiles.map((profile) => ({
    tool: 'propose', args: { eventId: state.eventId, profile },
  }));
  return state.candidates.filter((plan) => !state.validatedPlanIds.includes(plan.id))
    .map((plan) => ({ tool: 'validate', args: { planId: plan.id } }));
}

export function validatedCandidates(state: UrgentProgress): CandidatePlan[] {
  return state.candidates.filter((plan) => state.validatedPlanIds.includes(plan.id) &&
    plan.validations.ok && plan.validations.violations.length === 0 && plan.status !== 'REJECTED');
}
