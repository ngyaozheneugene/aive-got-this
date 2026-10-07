import { describe, expect, it } from 'vitest';
import { EASTWIND_DATE } from '../shared/config/demo';
import { EASTWIND } from '../shared/fixtures/eastwind';
import type { BoardSchedule, OperationalEvent } from '../shared/types/domain';
import { propose } from './propose';

describe('Weighted Insertion Propose Engine', () => {
  const mockSchedule: BoardSchedule = {
    date: EASTWIND_DATE,
    snapshotId: 'snap_v1',
    snapshotVersion: 1,
    technicians: EASTWIND.technicians,
    jobs: EASTWIND.jobs,
    assignments: EASTWIND.assignments,
    travel: EASTWIND.travel,
  };

  const urgentEvent: OperationalEvent = {
    id: 'evt_urgent_raffles',
    type: 'urgent_job',
    rawText: 'Urgent water leak at Raffles Place site',
    normalizedPayload: { jobId: 'job_raffles' },
    sourceSnapshotId: 'snap_v1',
    affectedIds: ['job_raffles'],
    validationIssues: [],
    status: 'VALIDATED',
    receivedAt: `${EASTWIND_DATE}T08:30:00+08:00`,
  };

  it('should generate two valid candidate plans (sla_first and minimal_disruption) for an urgent job', () => {
    const result = propose({
      event: urgentEvent,
      schedule: mockSchedule,
      profile: 'sla_first',
    });

    expect(result.engine).toBe('insertion');
    expect(result.timedOut).toBe(false);
    expect(result.plans).toHaveLength(2);

    const profiles = result.plans.map((p) => p.profile);
    expect(profiles).toContain('sla_first');
    expect(profiles).toContain('minimal_disruption');
  });

  it('should exclude unqualified technicians (Wei) and assign an eligible technician', () => {
    const result = propose({
      event: urgentEvent,
      schedule: mockSchedule,
      profile: 'sla_first',
    });

    const slaPlan = result.plans.find((p) => p.profile === 'sla_first');
    expect(slaPlan).toBeDefined();

    const targetSlot = slaPlan?.assignments.find((a) => a.jobId === 'job_raffles');
    expect(targetSlot).toBeDefined();
    // Wei must NOT be assigned because Wei's NEA_R32 cert is expired and tier is too low
    expect(targetSlot?.technicianId).not.toBe('tech_wei');
    expect(['tech_siti', 'tech_jonah', 'tech_hafiz', 'tech_kumar', 'tech_mei']).toContain(
      targetSlot?.technicianId,
    );
  });

  it('should pass independent hard-constraint validation on generated candidate plans', () => {
    const result = propose({
      event: urgentEvent,
      schedule: mockSchedule,
      profile: 'sla_first',
    });

    for (const plan of result.plans) {
      expect(plan.validations.ok).toBe(true);
      expect(plan.validations.violations).toHaveLength(0);
    }
  });

  it('starts an urgent job when the technician is actually free, not at the window opening', () => {
    // Siti and Jonah are the only legal technicians for Raffles Place. Book
    // both 12:45-13:30 in the west, so nobody is free at 13:00 when it opens.
    const busy = (id: string, tech: string) => ({
      ...EASTWIND.assignments[0]!,
      id,
      jobId: id,
      technicianId: tech,
      windowStart: `${EASTWIND_DATE}T12:45:00+08:00`,
      windowEnd: `${EASTWIND_DATE}T13:30:00+08:00`,
    });
    const filler = (id: string) => ({
      ...EASTWIND.jobs.find((j) => j.id === 'job_jonah_1')!,
      id,
      windowStart: `${EASTWIND_DATE}T12:45:00+08:00`,
      windowEnd: `${EASTWIND_DATE}T13:30:00+08:00`,
    });
    const schedule: BoardSchedule = {
      ...mockSchedule,
      jobs: [...EASTWIND.jobs, filler('job_busy_siti'), filler('job_busy_jonah')],
      assignments: [...EASTWIND.assignments, busy('job_busy_siti', 'tech_siti'), busy('job_busy_jonah', 'tech_jonah')],
    };

    const result = propose({ event: urgentEvent, schedule, profile: 'sla_first' });
    expect(result.plans).toHaveLength(2);
    for (const plan of result.plans) {
      const slot = plan.assignments.find((a) => a.jobId === 'job_raffles')!;
      // Clementi (west) to Raffles Place is 30 minutes, so 14:00 at the earliest.
      expect(slot.windowStart).toBe(`${EASTWIND_DATE}T14:00:00+08:00`);
      expect(plan.validations.violations).toEqual([]);
    }
  });
});
