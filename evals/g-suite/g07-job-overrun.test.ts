import { describe, expect, it } from 'vitest';
import { EASTWIND_DATE } from '../../src/shared/config/demo';
import { EASTWIND } from '../../src/shared/fixtures/eastwind';
import type { BoardSchedule, OperationalEvent } from '../../src/shared/types/domain';
import { proposeWithSidecar } from '../../src/matching/propose';
import { validatePlan } from '../../src/matching/validate';

describe('G-07: UC-04 Job overrun (45-minute overrun & frozen horizon)', () => {
  const schedule: BoardSchedule = {
    date: EASTWIND_DATE,
    snapshotId: 'snap_v1',
    snapshotVersion: 1,
    technicians: EASTWIND.technicians,
    jobs: EASTWIND.jobs,
    assignments: EASTWIND.assignments,
    travel: EASTWIND.travel,
  };

  const overrunEvent: OperationalEvent = {
    id: 'evt_g07',
    type: 'job_overrun',
    rawText: 'Job hafiz_1 on-site overrun by 45 minutes',
    normalizedPayload: { jobId: 'job_hafiz_1', overrunMinutes: 45 },
    sourceSnapshotId: 'snap_v1',
    affectedIds: ['job_hafiz_1'],
    validationIssues: [],
    status: 'VALIDATED',
    receivedAt: `${EASTWIND_DATE}T10:00:00+08:00`,
  };

  it('keeps overrunning in-progress job (job_hafiz_1) assigned to tech_hafiz with extended window', async () => {
    const result = await proposeWithSidecar({
      event: overrunEvent,
      schedule,
      profile: 'sla_first',
    });

    expect(result.plans.length).toBeGreaterThan(0);

    for (const plan of result.plans) {
      // Frozen horizon: in-progress job_hafiz_1 remains assigned to tech_hafiz
      const overrunSlot = plan.assignments.find((a) => a.jobId === 'job_hafiz_1');
      expect(overrunSlot).toBeDefined();
      expect(overrunSlot?.technicianId).toBe('tech_hafiz');

      const validation = validatePlan(plan, schedule);
      expect(validation.ok).toBe(true);
    }
  });
});
