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
});
