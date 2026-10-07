import { describe, expect, it } from 'vitest';
import { applyDisruption, unavailabilityOnDay, unavailabilityPatch, withinShift } from './disruption';
import { validatePlan } from './validate';
import { propose } from './propose';
import { buildScenario } from '../shared/fixtures/scenario';
import { createEventBodySchema, MAX_OVERRUN_MINUTES } from '../shared/contracts/events';
import type { BoardSchedule, CandidatePlan, OperationalEvent, Shift } from '../shared/types/domain';

const DATE = '2026-10-20';
const at = (hhmm: string) => `${DATE}T${hhmm}:00+08:00`;
const shift: Shift = {
  id: 's', technicianId: 'tech_kumar', shiftDate: DATE, status: 'clocked_in', clockInAt: at('07:45'), createdAt: at('00:00'),
};

function unavailable(payload: Record<string, unknown>): OperationalEvent {
  return {
    id: 'evt', type: 'technician_unavailable', rawText: '', normalizedPayload: { technicianId: 'tech_kumar', ...payload },
    affectedIds: ['tech_kumar'], validationIssues: [], status: 'VALIDATED', receivedAt: at('09:00'),
  };
}

function finalsSchedule(): BoardSchedule {
  const s = buildScenario(DATE);
  const jobs = s.jobs.filter((j) => j.scheduledDate === DATE);
  const ids = new Set(jobs.map((j) => j.id));
  return {
    date: DATE, snapshotId: s.snapshot.id, snapshotVersion: 1, technicians: s.technicians, jobs,
    assignments: s.assignments.filter((a) => ids.has(a.jobId)), travel: s.travel, certs: s.certs,
    shifts: s.shifts, jobRequirements: s.jobRequirements, sites: s.sites,
  };
}

describe('unavailabilityPatch', () => {
  it('takes the rest of the day as a sick day', () => {
    expect(unavailabilityPatch(shift, { technicianId: 'tech_kumar' })).toEqual({ status: 'mc' });
  });

  it('moves clock-in to "until", and clock-out to "from"', () => {
    expect(unavailabilityPatch(shift, { technicianId: 'x', until: at('14:00') })).toEqual({ clockInAt: at('14:00') });
    expect(unavailabilityPatch(shift, { technicianId: 'x', from: at('15:00') })).toEqual({ clockOutAt: at('15:00') });
  });

  it('never gives back hours: an earlier "until" or a later "from" changes nothing', () => {
    const late = { ...shift, clockInAt: at('10:00'), clockOutAt: at('16:00') };
    expect(unavailabilityPatch(late, { technicianId: 'x', until: at('09:00') })).toEqual({ clockInAt: at('10:00') });
    expect(unavailabilityPatch(late, { technicianId: 'x', from: at('17:00') })).toEqual({ clockOutAt: at('16:00') });
  });

  it('is idempotent when applied to a board twice', () => {
    const once = applyDisruption(finalsSchedule(), unavailable({ until: at('14:00') }));
    const twice = applyDisruption(once, unavailable({ until: at('14:00') }));
    expect(twice.shifts).toEqual(once.shifts);
  });

  it('checks the times are on the board day', () => {
    expect(unavailabilityOnDay({ technicianId: 'x', until: at('14:00') }, DATE)).toBe(true);
    expect(unavailabilityOnDay({ technicianId: 'x', until: '2026-10-21T14:00:00+08:00' }, DATE)).toBe(false);
  });
});

describe('withinShift', () => {
  it('holds work to clock-in, clock-out and a working status', () => {
    const cut = { ...shift, clockInAt: at('14:00'), clockOutAt: at('17:00') };
    expect(withinShift(cut, at('14:00'), at('15:00'))).toBe(true);
    expect(withinShift(cut, at('13:30'), at('14:30'))).toBe(false);
    expect(withinShift(cut, at('16:30'), at('17:30'))).toBe(false);
    expect(withinShift({ ...shift, status: 'mc' }, at('10:00'), at('11:00'))).toBe(false);
    expect(withinShift(undefined, at('10:00'), at('11:00'))).toBe(false);
  });
});

describe('validator and shift windows', () => {
  const plan = (assignments: CandidatePlan['assignments']) => ({ assignments }) as CandidatePlan;

  it('refuses work after an early clock-out', () => {
    const board = applyDisruption(finalsSchedule(), unavailable({ from: at('15:00') }));
    // Kumar's 15:30 top-up is now after he leaves.
    const asIs = plan(board.assignments.map((a) => ({ jobId: a.jobId, technicianId: a.technicianId, windowStart: a.windowStart, windowEnd: a.windowEnd })));
    expect(validatePlan(asIs, board).violations).toEqual(['OUTSIDE_SHIFT:tech=tech_kumar:job=job_kumar_3']);
  });

  it('lets a technician who goes off sick finish the job they are on', () => {
    const board = applyDisruption(finalsSchedule(), { ...unavailable({}), normalizedPayload: { technicianId: 'tech_hafiz' } });
    const onSite = board.assignments.find((a) => a.jobId === 'job_hafiz_1')!;
    const result = validatePlan(plan([{ jobId: onSite.jobId, technicianId: 'tech_hafiz', windowStart: onSite.windowStart, windowEnd: onSite.windowEnd }]), board);
    expect(result.violations).toEqual([]);
  });
});

describe('insertion fallback on part of a day', () => {
  it('moves only the jobs outside the new hours when Kumar is out until 14:00', () => {
    const result = propose({ event: unavailable({ until: at('14:00') }), schedule: finalsSchedule(), profile: 'sla_first' });
    expect(result.plans.length).toBeGreaterThan(0);
    for (const p of result.plans) {
      expect(p.validations.violations, p.profile).toEqual([]);
      const kumar = p.assignments.filter((a) => a.technicianId === 'tech_kumar').map((a) => a.jobId);
      // His 09:00 and 13:00 jobs go; his 15:30 stays.
      expect(kumar).toEqual(['job_kumar_3']);
    }
  });

  it('keeps everything with Kumar when he is back before his first job', () => {
    const result = propose({ event: unavailable({ until: at('08:30') }), schedule: finalsSchedule(), profile: 'sla_first' });
    for (const p of result.plans) {
      expect(p.metrics.jobsMoved, p.profile).toBe(0);
    }
  });
});

describe('event contract', () => {
  const body = (payload: Record<string, unknown>) => ({ type: 'technician_unavailable', payload: { technicianId: 'tech_kumar', ...payload } });

  it('accepts all day, until, or from', () => {
    for (const p of [{}, { until: at('14:00') }, { from: at('15:00') }]) {
      expect(createEventBodySchema.safeParse(body(p)).success, JSON.stringify(p)).toBe(true);
    }
  });

  it('refuses both bounds, a time without an offset, and an overrun past a working day', () => {
    expect(createEventBodySchema.safeParse(body({ from: at('11:00'), until: at('13:00') })).success).toBe(false);
    expect(createEventBodySchema.safeParse(body({ until: `${DATE}T14:00:00` })).success).toBe(false);
    const overrun = (minutes: number) => ({ type: 'job_overrun', payload: { jobId: 'job_hafiz_1', overrunMinutes: minutes } });
    expect(createEventBodySchema.safeParse(overrun(MAX_OVERRUN_MINUTES)).success).toBe(true);
    expect(createEventBodySchema.safeParse(overrun(MAX_OVERRUN_MINUTES + 1)).success).toBe(false);
  });
});
