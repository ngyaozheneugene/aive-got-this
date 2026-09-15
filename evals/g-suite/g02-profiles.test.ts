import { describe, expect, it } from 'vitest';
import { EASTWIND_DATE } from '../../src/shared/config/demo';
import { EASTWIND } from '../../src/shared/fixtures/eastwind';
import type { BoardSchedule, OperationalEvent } from '../../src/shared/types/domain';
import { propose } from '../../src/matching/propose';

describe('G-02: Dual profile generation (sla_first vs minimal_disruption)', () => {
  const schedule: BoardSchedule = {
    date: EASTWIND_DATE,
    snapshotId: 'snap_v1',
    snapshotVersion: 1,
    technicians: EASTWIND.technicians,
    jobs: EASTWIND.jobs,
    assignments: EASTWIND.assignments,
    travel: EASTWIND.travel,
  };

  const event: OperationalEvent = {
    id: 'evt_g02',
    type: 'urgent_job',
    rawText: 'Urgent leak at Raffles Place',
    normalizedPayload: { jobId: 'job_raffles' },
    sourceSnapshotId: 'snap_v1',
    affectedIds: ['job_raffles'],
    validationIssues: [],
    status: 'VALIDATED',
    receivedAt: `${EASTWIND_DATE}T08:30:00+08:00`,
  };

  it('generates candidate plans for both sla_first and minimal_disruption profiles', () => {
    const out = propose({ event, schedule, profile: 'sla_first' });
    expect(out.plans).toHaveLength(2);

    const profiles = out.plans.map((p) => p.profile);
    expect(profiles).toContain('sla_first');
    expect(profiles).toContain('minimal_disruption');
  });

  it('marks the requested profile as RECOMMENDED', () => {
    const outSla = propose({ event, schedule, profile: 'sla_first' });
    const slaPlan = outSla.plans.find((p) => p.profile === 'sla_first');
    expect(slaPlan?.status).toBe('RECOMMENDED');

    const outMin = propose({ event, schedule, profile: 'minimal_disruption' });
    const minPlan = outMin.plans.find((p) => p.profile === 'minimal_disruption');
    expect(minPlan?.status).toBe('RECOMMENDED');
  });
});
