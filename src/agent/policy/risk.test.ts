import { describe, expect, it } from 'vitest';
import { emptyPlanMetrics } from '../../shared/types/domain';
import type { Assignment, CandidatePlan } from '../../shared/types/domain';
import { classifyProposalRisk, modeForRisk } from './risk';

function assignment(
  overrides: Partial<Assignment> & Pick<Assignment, 'jobId' | 'technicianId'>,
): Pick<Assignment, 'jobId' | 'technicianId' | 'status' | 'windowStart' | 'windowEnd'> {
  return {
    status: 'accepted',
    windowStart: '2026-09-15T09:00:00+08:00',
    windowEnd: '2026-09-15T10:00:00+08:00',
    ...overrides,
  };
}

function plan(overrides: Partial<CandidatePlan> = {}): CandidatePlan {
  return {
    id: 'plan_a',
    proposalId: 'prop_a',
    sourceSnapshotId: 'snap_1',
    profile: 'sla_first',
    assignments: [{
      jobId: 'job_existing',
      technicianId: 'tech_siti',
      windowStart: '2026-09-15T09:00:00+08:00',
      windowEnd: '2026-09-15T10:00:00+08:00',
    }],
    changeSet: [],
    metrics: emptyPlanMetrics(),
    validations: { ok: true, violations: [] },
    solverTrace: {},
    timedOut: false,
    status: 'VALIDATED',
    createdAt: '2026-09-15T00:00:00Z',
    ...overrides,
  };
}

const liveBoard = [assignment({ jobId: 'job_existing', technicianId: 'tech_siti' })];

describe('modeForRisk', () => {
  it('maps the frozen policy table', () => {
    expect(modeForRisk('low')).toBe('auto');
    expect(modeForRisk('medium')).toBe('approval');
    expect(modeForRisk('high')).toBe('block');
  });
});

describe('classifyProposalRisk', () => {
  it('blocks an empty feasible set (UC-02)', () => {
    expect(classifyProposalRisk({ plans: [], liveAssignments: liveBoard })).toEqual({
      risk: 'high', autonomyMode: 'block', reasons: ['infeasible'],
    });
  });

  it('blocks failed validation and missing legal certs even if a change looks small', () => {
    const classified = classifyProposalRisk({
      liveAssignments: liveBoard,
      plans: [plan({
        status: 'REJECTED',
        validations: { ok: false, violations: ['MISSING_CERT:tech=tech_wei:cert=NITEC_HVAC'] },
      })],
    });
    expect(classified).toEqual({
      risk: 'high',
      autonomyMode: 'block',
      reasons: ['validation_failed', 'missing_or_expired_cert'],
    });
  });

  it('blocks excessive overtime (validator code), not ordinary overtime minutes', () => {
    expect(classifyProposalRisk({
      liveAssignments: liveBoard,
      plans: [plan({
        metrics: { ...emptyPlanMetrics(), overtimeMinutes: 12 },
      })],
    })).toMatchObject({ risk: 'medium', autonomyMode: 'approval', reasons: ['overtime'] });

    expect(classifyProposalRisk({
      liveAssignments: liveBoard,
      plans: [plan({
        validations: { ok: false, violations: ['EXCESSIVE_OVERTIME'] },
        metrics: { ...emptyPlanMetrics(), overtimeMinutes: 90 },
      })],
    })).toMatchObject({ risk: 'high', autonomyMode: 'block' });
  });

  it('blocks incomplete slots instead of inventing an assignee', () => {
    expect(classifyProposalRisk({
      liveAssignments: liveBoard,
      plans: [plan({ assignments: [{ jobId: 'job_existing', technicianId: '' }] })],
    })).toEqual({
      risk: 'high', autonomyMode: 'block', reasons: ['incomplete_assignment'],
    });
  });

  it('requires approval for a new urgent assignment (UC-01 Raffles)', () => {
    expect(classifyProposalRisk({
      liveAssignments: liveBoard,
      plans: [plan({
        assignments: [
          ...plan().assignments,
          { jobId: 'job_raffles', technicianId: 'tech_jonah' },
        ],
        changeSet: [{ action: 'assign', jobId: 'job_raffles', technicianId: 'tech_jonah' }],
      })],
    })).toEqual({
      risk: 'medium', autonomyMode: 'approval', reasons: ['new_assignment'],
    });
  });

  it('requires approval for a technician or window move', () => {
    expect(classifyProposalRisk({
      liveAssignments: liveBoard,
      plans: [plan({
        assignments: [{
          jobId: 'job_existing',
          technicianId: 'tech_jonah',
          windowStart: '2026-09-15T09:00:00+08:00',
          windowEnd: '2026-09-15T10:00:00+08:00',
        }],
      })],
    }).reasons).toContain('reassignment');

    expect(classifyProposalRisk({
      liveAssignments: liveBoard,
      plans: [plan({
        assignments: [{
          jobId: 'job_existing',
          technicianId: 'tech_siti',
          windowStart: '2026-09-15T11:00:00+08:00',
          windowEnd: '2026-09-15T12:00:00+08:00',
        }],
      })],
    })).toMatchObject({ risk: 'medium', reasons: ['window_moved'] });
  });

  it('is AUTO only when every live slot is unchanged and no overtime', () => {
    expect(classifyProposalRisk({
      liveAssignments: liveBoard,
      plans: [plan()],
    })).toEqual({ risk: 'low', autonomyMode: 'auto', reasons: [] });
  });

  it('takes the stricter of two candidate plans', () => {
    const classified = classifyProposalRisk({
      liveAssignments: liveBoard,
      plans: [
        plan(),
        plan({
          id: 'plan_b',
          validations: { ok: false, violations: ['WINDOW_INFEASIBLE'] },
        }),
      ],
    });
    expect(classified.risk).toBe('high');
    expect(classified.autonomyMode).toBe('block');
  });
});
