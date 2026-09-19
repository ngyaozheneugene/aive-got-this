import { describe, expect, it } from 'vitest';
import { EASTWIND_DATE } from '../../src/shared/config/demo';
import { EASTWIND } from '../../src/shared/fixtures/eastwind';
import type { BoardSchedule, CandidatePlan } from '../../src/shared/types/domain';
import { validatePlan } from '../../src/matching/validate';

describe('G-04: Independent validator integrity checks', () => {
  const schedule: BoardSchedule = {
    date: EASTWIND_DATE,
    snapshotId: 'snap_v1',
    snapshotVersion: 1,
    technicians: EASTWIND.technicians,
    jobs: EASTWIND.jobs,
    assignments: EASTWIND.assignments,
    travel: EASTWIND.travel,
  };

  it('rejects a candidate plan with overlapping technician time slots', () => {
    const invalidPlan: CandidatePlan = {
      id: 'plan_invalid_overlap',
      proposalId: 'prop_test',
      sourceSnapshotId: 'snap_v1',
      profile: 'sla_first',
      assignments: [
        {
          jobId: 'job_1',
          technicianId: 'tech_siti',
          windowStart: `${EASTWIND_DATE}T09:00:00+08:00`,
          windowEnd: `${EASTWIND_DATE}T11:00:00+08:00`,
        },
        {
          jobId: 'job_2',
          technicianId: 'tech_siti',
          windowStart: `${EASTWIND_DATE}T10:00:00+08:00`, // Overlaps with job_1
          windowEnd: `${EASTWIND_DATE}T12:00:00+08:00`,
        },
      ],
      changeSet: [],
      metrics: {
        slaLatenessMinutes: 0,
        travelMinutes: 30,
        overtimeMinutes: 0,
        jobsMoved: 1,
        customersAffected: 2,
        unassignedCount: 0,
      },
      validations: { ok: true, violations: [] },
      solverTrace: {},
      timedOut: false,
      status: 'VALIDATED',
      createdAt: `${EASTWIND_DATE}T08:00:00+08:00`,
    };

    const validation = validatePlan(invalidPlan, schedule);
    expect(validation.ok).toBe(false);
    expect(validation.violations.some((v) => v.includes('OVERLAP'))).toBe(true);
  });

  it('rejects a candidate plan that moves an in-progress job to another technician', () => {
    const invalidPlan: CandidatePlan = {
      id: 'plan_invalid_in_progress',
      proposalId: 'prop_test',
      sourceSnapshotId: 'snap_v1',
      profile: 'sla_first',
      assignments: [
        {
          jobId: 'job_hafiz_1', // In-progress job assigned to Hafiz
          technicianId: 'tech_kumar', // Illegally reassigned to Kumar
          windowStart: `${EASTWIND_DATE}T08:30:00+08:00`,
          windowEnd: `${EASTWIND_DATE}T09:30:00+08:00`,
        },
      ],
      changeSet: [],
      metrics: {
        slaLatenessMinutes: 0,
        travelMinutes: 15,
        overtimeMinutes: 0,
        jobsMoved: 1,
        customersAffected: 1,
        unassignedCount: 0,
      },
      validations: { ok: true, violations: [] },
      solverTrace: {},
      timedOut: false,
      status: 'VALIDATED',
      createdAt: `${EASTWIND_DATE}T08:00:00+08:00`,
    };

    const validation = validatePlan(invalidPlan, schedule);
    expect(validation.ok).toBe(false);
    expect(validation.violations).toContain('IN_PROGRESS_MOVED:job_hafiz_1');
  });
});
