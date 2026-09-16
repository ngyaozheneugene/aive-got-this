import { describe, expect, it } from 'vitest';
import { EASTWIND_DATE } from '../../src/shared/config/demo';
import { EASTWIND } from '../../src/shared/fixtures/eastwind';
import type { BoardSchedule, OperationalEvent } from '../../src/shared/types/domain';
import { proposeWithSidecar } from '../../src/matching/propose';
import { validatePlan } from '../../src/matching/validate';

describe('G-06: Technician unavailability replan (in-progress job locked)', () => {
  const schedule: BoardSchedule = {
    date: EASTWIND_DATE,
    snapshotId: 'snap_v1',
    snapshotVersion: 1,
    technicians: EASTWIND.technicians,
    jobs: EASTWIND.jobs,
    assignments: EASTWIND.assignments,
    travel: EASTWIND.travel,
  };

  const hafizUnavailableEvent: OperationalEvent = {
    id: 'evt_g06',
    type: 'technician_unavailable',
    rawText: 'Hafiz sick after morning job, unable to continue shift',
    normalizedPayload: { technicianId: 'tech_hafiz' },
    sourceSnapshotId: 'snap_v1',
    affectedIds: ['tech_hafiz', 'job_hafiz_2', 'job_hafiz_3'],
    validationIssues: [],
    status: 'VALIDATED',
    receivedAt: `${EASTWIND_DATE}T10:00:00+08:00`,
  };

  it('keeps in-progress job (job_hafiz_1) assigned to tech_hafiz while replanning remaining jobs', async () => {
    const result = await proposeWithSidecar({
      event: hafizUnavailableEvent,
      schedule,
      profile: 'sla_first',
    });

    expect(result.plans.length).toBeGreaterThan(0);

    for (const plan of result.plans) {
      // In-progress job job_hafiz_1 must stay with tech_hafiz
      const inProgressSlot = plan.assignments.find((a) => a.jobId === 'job_hafiz_1');
      if (inProgressSlot) {
        expect(inProgressSlot.technicianId).toBe('tech_hafiz');
      }

      // Remaining assigned jobs (job_hafiz_2, job_hafiz_3) must NOT be assigned to tech_hafiz
      const remainingSlots = plan.assignments.filter(
        (a) => a.jobId === 'job_hafiz_2' || a.jobId === 'job_hafiz_3',
      );
      for (const slot of remainingSlots) {
        expect(slot.technicianId).not.toBe('tech_hafiz');
      }

      // Candidate plan must pass independent validator
      const validation = validatePlan(plan, schedule);
      expect(validation.ok).toBe(true);
    }
  });
});
