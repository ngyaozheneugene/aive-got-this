import { describe, expect, it } from 'vitest';
import { EASTWIND_DATE } from '../../src/shared/config/demo';
import { EASTWIND } from '../../src/shared/fixtures/eastwind';
import type { BoardSchedule, OperationalEvent } from '../../src/shared/types/domain';
import { travelMinutes } from '../../src/location/matrix';
import { propose } from '../../src/matching/propose';

describe('G-05: Travel matrix routing integrity vs crow-flies', () => {
  const schedule: BoardSchedule = {
    date: EASTWIND_DATE,
    snapshotId: 'snap_v1',
    snapshotVersion: 1,
    technicians: EASTWIND.technicians,
    jobs: EASTWIND.jobs,
    assignments: EASTWIND.assignments,
    travel: EASTWIND.travel,
  };

  it('uses actual fixture matrix travel times rather than flat 20-min or crow-flies distance', () => {
    // CBD -> East is 22 mins off-peak, 34 mins peak
    const offPeak = travelMinutes('cbd', 'east', EASTWIND.travel, false);
    const peak = travelMinutes('cbd', 'east', EASTWIND.travel, true);

    expect(offPeak).toBe(22);
    expect(peak).toBe(34);
    expect(offPeak).not.toBe(20);
  });

  it('throws error when a cluster pair is not present in matrix', () => {
    expect(() => travelMinutes('cbd', 'unknown_cluster', EASTWIND.travel)).toThrow(
      'TRAVEL_MATRIX_MISSING:cbd->unknown_cluster',
    );
  });

  it('correctly incorporates travel matrix durations into candidate plan metrics', () => {
    const event: OperationalEvent = {
      id: 'evt_g05',
      type: 'urgent_job',
      rawText: 'Urgent leak at Raffles Place',
      normalizedPayload: { jobId: 'job_raffles' },
      sourceSnapshotId: 'snap_v1',
      affectedIds: ['job_raffles'],
      validationIssues: [],
      status: 'VALIDATED',
      receivedAt: `${EASTWIND_DATE}T08:30:00+08:00`,
    };

    const result = propose({ event, schedule, profile: 'sla_first' });
    expect(result.plans.length).toBeGreaterThan(0);
    for (const plan of result.plans) {
      expect(plan.metrics.travelMinutes).toBeGreaterThan(0);
    }
  });
});
