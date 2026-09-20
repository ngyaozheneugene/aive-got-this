import { describe, expect, it } from 'vitest';
import { emptyPlanMetrics } from '../../shared/types/domain';
import type { CandidatePlan } from '../../shared/types/domain';
import { compareCandidatePlans } from './compare';

function plan(profile: CandidatePlan['profile'], travelMinutes: number): CandidatePlan {
  return {
    id: `plan_${profile}`, proposalId: 'prop', sourceSnapshotId: 'snap',
    profile, assignments: [], changeSet: [],
    metrics: { ...emptyPlanMetrics(), travelMinutes },
    validations: { ok: true, violations: [] }, solverTrace: {}, timedOut: false,
    status: 'VALIDATED', createdAt: '2026-09-15T00:00:00Z',
  };
}

describe('compareCandidatePlans', () => {
  it('diffs stored metrics and never invents a ranking', () => {
    const compared = compareCandidatePlans([plan('sla_first', 22), plan('minimal_disruption', 50)]);
    expect(compared.comparisonReady).toBe(true);
    expect(compared.deltas.travelMinutes).toBe(-28);
    expect(compared.reasons).toEqual(['stored_metrics_only']);
  });

  it('does not call a one-profile result a comparison', () => {
    expect(compareCandidatePlans([plan('sla_first', 22)]).comparisonReady).toBe(false);
  });
});
