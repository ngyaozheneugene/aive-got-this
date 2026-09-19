import { describe, expect, it } from 'vitest';
import { EASTWIND_DATE } from '../../src/shared/config/demo';
import { EASTWIND } from '../../src/shared/fixtures/eastwind';
import type { BoardSchedule, OperationalEvent } from '../../src/shared/types/domain';
import { propose } from '../../src/matching/propose';
import { travelMinutes } from '../../src/location/matrix';

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

  // The G1 exit line is two *meaningfully different* valid candidates. The two
  // tests above pass whether or not that is true: they only count plans and
  // check a status. On the deployed box both candidates were identical in all
  // twelve slots while this file was green.
  it('offers two genuinely different candidates, not the same plan twice', () => {
    const out = propose({ event, schedule, profile: 'sla_first' });
    const chosen = out.plans.map(
      (p) => p.assignments.find((a) => a.jobId === 'job_raffles')?.technicianId,
    );

    expect(chosen.filter(Boolean)).toHaveLength(2);
    expect(new Set(chosen).size).toBe(2);
    for (const plan of out.plans) expect(plan.validations.ok).toBe(true);
  });

  it('separates the profiles on their own objective', () => {
    const out = propose({ event, schedule, profile: 'sla_first' });
    const sla = out.plans.find((p) => p.profile === 'sla_first')!;
    const min = out.plans.find((p) => p.profile === 'minimal_disruption')!;

    // Soonest on site takes the shorter drive; least knock-on takes the
    // technician with more of the day left, and pays for it in travel.
    expect(sla.metrics.travelMinutes).toBeLessThan(min.metrics.travelMinutes);
    expect(
      (min.solverTrace as { loadPressure: number }).loadPressure,
    ).toBeLessThan((sla.solverTrace as { loadPressure: number }).loadPressure);
  });

  it('computes metrics rather than reporting placeholder zeros', () => {
    const out = propose({ event, schedule, profile: 'sla_first' });
    for (const plan of out.plans) {
      // Travel comes from the matrix, so it can never be the old hardcoded 30
      // for every candidate, and never zero for a van that has to drive.
      expect(plan.metrics.travelMinutes).toBeGreaterThan(0);
      expect(plan.metrics.unassignedCount).toBe(0);
      expect(plan.metrics.slaLatenessMinutes).toBe(0);
    }
    const travels = out.plans.map((p) => p.metrics.travelMinutes);
    expect(new Set(travels).size).toBe(2);
  });

  it('measures travel to the job cluster, not always to the CBD', () => {
    // Travel used to be computed to a hardcoded 'cbd' destination, which is
    // right for Raffles Place and wrong for the other eleven jobs on the board.
    const bedok = EASTWIND.jobs.find((j) => j.id === 'job_hafiz_2')!;
    const bedokEvent: OperationalEvent = {
      ...event,
      id: 'evt_g02_bedok',
      normalizedPayload: { jobId: bedok.id },
      affectedIds: [bedok.id],
    };

    const out = propose({ event: bedokEvent, schedule, profile: 'sla_first' });
    expect(out.plans.length).toBeGreaterThan(0);

    for (const plan of out.plans) {
      const slot = plan.assignments.find((a) => a.jobId === bedok.id)!;
      const tech = EASTWIND.technicians.find((t) => t.id === slot.technicianId)!;
      const toBedok = travelMinutes(tech.currentCluster || 'cbd', 'bedok', EASTWIND.travel);
      expect(slot.travelBeforeMinutes).toBe(toBedok);
    }
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
