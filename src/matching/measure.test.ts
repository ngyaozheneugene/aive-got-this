import { describe, expect, it } from 'vitest';
import { EASTWIND_DATE } from '../shared/config/demo';
import { EASTWIND } from '../shared/fixtures/eastwind';
import type { BoardSchedule, OperationalEvent, OperationalEventType, PlannedSlot } from '../shared/types/domain';
import { measurePlan } from './measure';
import { propose } from './propose';

const schedule: BoardSchedule = {
  date: EASTWIND_DATE,
  snapshotId: 'snap_v1',
  snapshotVersion: 1,
  technicians: EASTWIND.technicians,
  jobs: EASTWIND.jobs,
  assignments: EASTWIND.assignments,
  travel: EASTWIND.travel,
  certs: EASTWIND.certs,
  shifts: EASTWIND.shifts,
  jobRequirements: EASTWIND.jobRequirements,
  sites: EASTWIND.sites,
};

function event(type: OperationalEventType, payload: Record<string, unknown>, affected: string[]): OperationalEvent {
  return {
    id: `evt_${type}`,
    type,
    rawText: '',
    normalizedPayload: payload,
    sourceSnapshotId: 'snap_v1',
    affectedIds: affected,
    validationIssues: [],
    status: 'VALIDATED',
    receivedAt: `${EASTWIND_DATE}T08:30:00+08:00`,
  };
}

const live: PlannedSlot[] = EASTWIND.assignments.map((a) => ({
  jobId: a.jobId,
  technicianId: a.technicianId,
  windowStart: a.windowStart,
  windowEnd: a.windowEnd,
}));

describe('measurePlan', () => {
  it('reads the unchanged board as zero change, and reports its workload gap', () => {
    const { metrics, workload } = measurePlan(live, event('urgent_job', { jobId: 'job_raffles' }, ['job_raffles']), schedule);
    expect(metrics).toMatchObject({ travelMinutes: 0, jobsMoved: 0, customersAffected: 0, unassignedCount: 1 });
    // Hafiz is booked 5h30 of 8h; Wei and Jonah 2h each.
    expect(workload.find((w) => w.technicianId === 'tech_hafiz')?.utilisationPct).toBe(69);
    expect(metrics.workloadSpreadPct).toBe(69 - 25);
  });

  it('charges the drive a new job adds, from where the technician was before it', () => {
    const plan = [...live, { jobId: 'job_raffles', technicianId: 'tech_siti', windowStart: `${EASTWIND_DATE}T13:00:00+08:00`, windowEnd: `${EASTWIND_DATE}T14:30:00+08:00` }];
    const { metrics, travelBefore } = measurePlan(plan, event('urgent_job', { jobId: 'job_raffles' }, ['job_raffles']), schedule);
    // Siti's last job is in Tampines (east); east to the CBD is 22 minutes.
    expect(travelBefore.get('job_raffles')).toBe(22);
    expect(metrics.travelMinutes).toBe(22);
    expect(metrics.customersAffected).toBe(1);
    expect(metrics.unassignedCount).toBe(0);
  });

  it('counts an overrun as lateness, not as a moved job', () => {
    const plan = live.map((s) => (s.jobId === 'job_hafiz_1' ? { ...s, windowEnd: `${EASTWIND_DATE}T10:45:00+08:00` } : s));
    const { metrics } = measurePlan(plan, event('job_overrun', { jobId: 'job_hafiz_1', overrunMinutes: 45 }, ['job_hafiz_1']), schedule);
    expect(metrics).toMatchObject({ slaLatenessMinutes: 45, jobsMoved: 0, customersAffected: 1, travelMinutes: 0 });
  });

  it('leaves the unavailable technician out of the balance', () => {
    const { workload } = measurePlan(live, event('technician_unavailable', { technicianId: 'tech_hafiz' }, ['tech_hafiz']), schedule);
    expect(workload.map((w) => w.technicianId)).not.toContain('tech_hafiz');
  });
});

describe('insertion fallbacks report measured numbers', () => {
  it('technician_unavailable: legal colleagues, real travel, and two different trade-offs', () => {
    const out = propose({ event: event('technician_unavailable', { technicianId: 'tech_hafiz' }, ['tech_hafiz']), schedule, profile: 'sla_first' });
    expect(out.plans).toHaveLength(2);
    for (const plan of out.plans) {
      expect(plan.validations.violations).toEqual([]);
      expect(plan.metrics.jobsMoved).toBe(2);
      expect(plan.assignments.find((a) => a.jobId === 'job_hafiz_1')?.technicianId).toBe('tech_hafiz');
    }
    const [sla, quiet] = ['sla_first', 'minimal_disruption'].map((p) => out.plans.find((x) => x.profile === p)!);
    // Same trade as the solver: sla_first pays extra driving to even out the
    // day; minimal_disruption disturbs one colleague and drives less.
    expect(sla!.metrics.workloadSpreadPct!).toBeLessThan(quiet!.metrics.workloadSpreadPct!);
    expect(sla!.metrics.travelMinutes).toBeGreaterThan(quiet!.metrics.travelMinutes);
    const holders = (p: typeof sla) => new Set(p!.assignments
      .filter((a) => a.jobId === 'job_hafiz_2' || a.jobId === 'job_hafiz_3').map((a) => a.technicianId)).size;
    expect(holders(sla)).toBe(2);
    expect(holders(quiet)).toBe(1);
  });

  it('technician_unavailable: no plan when nobody legal can cover, rather than an illegal one', () => {
    const out = propose({ event: event('technician_unavailable', { technicianId: 'tech_kumar' }, ['tech_kumar']), schedule, profile: 'sla_first' });
    expect(out.plans).toEqual([]);
    expect(out.message).toBe('no_legal_technician');
  });

  it('job_overrun 45: absorbed, nothing else moves', () => {
    const out = propose({ event: event('job_overrun', { jobId: 'job_hafiz_1', overrunMinutes: 45 }, ['job_hafiz_1']), schedule, profile: 'sla_first' });
    for (const plan of out.plans) {
      expect(plan.validations.violations).toEqual([]);
      expect(plan.metrics).toMatchObject({ slaLatenessMinutes: 45, jobsMoved: 0, travelMinutes: 0, overtimeMinutes: 0 });
    }
  });

  it('job_overrun 90: the colliding job moves legally and the drive is counted', () => {
    const out = propose({ event: event('job_overrun', { jobId: 'job_hafiz_1', overrunMinutes: 90 }, ['job_hafiz_1']), schedule, profile: 'sla_first' });
    expect(out.plans).toHaveLength(2);
    for (const plan of out.plans) {
      expect(plan.validations.violations).toEqual([]);
      expect(plan.metrics.jobsMoved).toBe(1);
      expect(plan.metrics.travelMinutes).not.toBe(30);
    }
  });
});
