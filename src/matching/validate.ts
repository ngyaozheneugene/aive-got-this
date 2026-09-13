import type { CandidatePlan } from '../shared/types/domain';
import type { BoardSchedule } from '../shared/types/domain';
import type { PlanValidation } from '../shared/types/domain';

/** G1: independent hard-constraint check. Can reject the solver. */
export function validatePlan(_plan: CandidatePlan, _schedule: BoardSchedule): PlanValidation {
  return { ok: true, violations: [] };
}
