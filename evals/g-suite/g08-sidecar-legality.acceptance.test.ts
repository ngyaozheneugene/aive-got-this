/**
 * G-08: the real OR-Tools sidecar must return legal plans.
 *
 * Every other test runs without a reachable sidecar, so proposeWithSidecar
 * silently falls back to insertion and passes. That is how a solver that placed
 * every job at 09:00-10:30 and ignored certificates reached production: on the
 * box it was the only thing answering, the validator rejected all of its plans,
 * and technician_unavailable and job_overrun returned no candidates at all.
 *
 * This gate refuses the fallback. `engine` must be 'ortools', or the test fails.
 *
 *   docker compose up -d optimizer
 *   RUN_SIDECAR_ACCEPTANCE=1 OPTIMIZER_URL=http://localhost:8081 npx vitest run evals/g-suite/g08-sidecar-legality.acceptance.test.ts
 */
import { describe, expect, it } from 'vitest';
import { InMemoryDatabase } from '../../src/db/memory';
import { buildBoardSchedule } from '../../src/dispatch/board-schedule';
import { proposeWithSidecar } from '../../src/matching/propose';
import type { CandidatePlan, OperationalEventType, PlanProfile } from '../../src/shared/types/domain';

const enabled = process.env.RUN_SIDECAR_ACCEPTANCE === '1';
const PROFILES: PlanProfile[] = ['sla_first', 'minimal_disruption'];

async function solve(
  type: OperationalEventType,
  payload: Record<string, unknown>,
  affected: string[],
  reshape?: (schedule: Awaited<ReturnType<typeof buildBoardSchedule>>) => void,
) {
  const db = new InMemoryDatabase();
  const schedule = await buildBoardSchedule(db);
  reshape?.(schedule);
  const snapshot = await db.boardSnapshots.getLatest();
  const event = await db.events.create({
    type,
    rawText: '',
    normalizedPayload: payload,
    sourceSnapshotId: snapshot!.id,
    affectedIds: affected,
    validationIssues: [],
    status: 'VALIDATED',
  });

  const live = new Map(
    schedule.assignments.map((a) => [a.jobId, `${a.technicianId} ${a.windowStart}-${a.windowEnd}`]),
  );
  const plans: Record<PlanProfile, CandidatePlan> = {} as Record<PlanProfile, CandidatePlan>;
  for (const profile of PROFILES) {
    const out = await proposeWithSidecar({ event, schedule, profile });
    // The seam assertion. A fallback here is the bug this file exists to catch.
    expect(out.engine, 'the sidecar must answer, not the insertion fallback').toBe('ortools');
    expect(out.timedOut).toBe(false);
    expect(out.plans).toHaveLength(1);
    plans[profile] = out.plans[0]!;
  }
  return { schedule, live, plans };
}

function slotOf(plan: CandidatePlan, jobId: string) {
  return plan.assignments.find((a) => a.jobId === jobId);
}

function hhmm(iso?: string) {
  return (iso ?? '').slice(11, 16);
}

describe.skipIf(!enabled)('G-08 real OR-Tools sidecar legality', () => {
  it('replans a sick technician legally, touching only their unstarted jobs', async () => {
    const { live, plans } = await solve('technician_unavailable', { technicianId: 'tech_hafiz' }, ['tech_hafiz']);

    for (const profile of PROFILES) {
      const plan = plans[profile];
      expect(plan.validations.violations, `${profile} violations`).toEqual([]);
      expect(plan.validations.ok).toBe(true);

      // Hafiz keeps only the job he is already on site for.
      const hafiz = plan.assignments.filter((a) => a.technicianId === 'tech_hafiz').map((a) => a.jobId);
      expect(hafiz).toEqual(['job_hafiz_1']);

      // Raffles Place is unassigned on this board and nothing to do with the event.
      expect(slotOf(plan, 'job_raffles')).toBeUndefined();

      // Every job that was not Hafiz's is exactly where it was.
      for (const slot of plan.assignments) {
        if (slot.jobId === 'job_hafiz_2' || slot.jobId === 'job_hafiz_3') continue;
        expect(`${slot.technicianId} ${slot.windowStart}-${slot.windowEnd}`).toBe(live.get(slot.jobId));
      }
      expect(plan.metrics.jobsMoved).toBe(2);
    }
  });

  it('absorbs a 45-minute overrun without moving anyone', async () => {
    const { live, plans } = await solve(
      'job_overrun', { jobId: 'job_hafiz_1', overrunMinutes: 45 }, ['job_hafiz_1'],
    );

    for (const profile of PROFILES) {
      const plan = plans[profile];
      expect(plan.validations.violations, `${profile} violations`).toEqual([]);
      expect(hhmm(slotOf(plan, 'job_hafiz_1')?.windowEnd)).toBe('10:45');

      // Hafiz's next job starts at 11:00, and a same-cluster drive is 8 minutes.
      // The overrun fits, so the right answer is to change nothing else.
      for (const slot of plan.assignments) {
        if (slot.jobId === 'job_hafiz_1') continue;
        expect(`${slot.technicianId} ${slot.windowStart}-${slot.windowEnd}`).toBe(live.get(slot.jobId));
      }
      expect(plan.metrics.jobsMoved).toBe(0);
      expect(plan.metrics.slaLatenessMinutes).toBe(45);
    }
  });

  it('reassigns the next job when a 90-minute overrun collides with it', async () => {
    const { plans } = await solve(
      'job_overrun', { jobId: 'job_hafiz_1', overrunMinutes: 90 }, ['job_hafiz_1'],
    );

    for (const profile of PROFILES) {
      const plan = plans[profile];
      expect(plan.validations.violations, `${profile} violations`).toEqual([]);
      expect(hhmm(slotOf(plan, 'job_hafiz_1')?.windowEnd)).toBe('11:30');

      // Hafiz is busy until 11:30 and job_hafiz_2 is booked from 11:00, so it
      // cannot stay with him. It moves, and the plan is still legal.
      const next = slotOf(plan, 'job_hafiz_2')!;
      expect(next.technicianId).not.toBe('tech_hafiz');
      expect(plan.metrics.jobsMoved).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps the Raffles comparison: nearest van against the one with room', async () => {
    const { plans } = await solve('urgent_job', { jobId: 'job_raffles' }, ['job_raffles']);
    for (const profile of PROFILES) {
      expect(plans[profile].validations.violations, `${profile} violations`).toEqual([]);
      // An urgent job starts as soon as its window opens, whichever profile.
      expect(hhmm(slotOf(plans[profile], 'job_raffles')?.windowStart)).toBe('13:00');
      expect(plans[profile].metrics.jobsMoved).toBe(0);
    }
    expect(slotOf(plans.sla_first, 'job_raffles')?.technicianId).toBe('tech_siti');
    expect(slotOf(plans.minimal_disruption, 'job_raffles')?.technicianId).toBe('tech_jonah');
  });

  it('evens out the day when a sick technician leaves one colleague overloaded', async () => {
    const { plans } = await solve('technician_unavailable', { technicianId: 'tech_hafiz' }, ['tech_hafiz']);
    // minimal_disruption disturbs one colleague; sla_first pays for extra
    // driving to stop that colleague ending at 69% while Wei sits at 25%.
    const gap = (p: CandidatePlan) => p.metrics.workloadSpreadPct ?? Infinity;
    expect(gap(plans.sla_first)).toBeLessThan(gap(plans.minimal_disruption));
    expect(plans.sla_first.metrics.travelMinutes).toBeGreaterThan(plans.minimal_disruption.metrics.travelMinutes);
    const holders = new Set(plans.sla_first.assignments
      .filter((a) => a.jobId === 'job_hafiz_2' || a.jobId === 'job_hafiz_3').map((a) => a.technicianId));
    expect(holders.size).toBe(2);
  });

  it('rebalances around an urgent job: frees the only qualified technician', async () => {
    // Raffles must start at 13:00 and needs the inverter board. Jonah has none
    // today, and Siti is booked 13:00-14:15 for a job others can do. Insertion
    // can only overlap her; the solver hands her booked job to a colleague at
    // the customer's booked time, and gives her Raffles.
    const at = (hm: string) => `2026-09-15T${hm}:00+08:00`;
    const { live, plans } = await solve('urgent_job', { jobId: 'job_raffles' }, ['job_raffles'], (s) => {
      s.jobs.find((j) => j.id === 'job_raffles')!.windowEnd = at('14:30');
      const booked = s.jobs.find((j) => j.id === 'job_siti_2')!;
      booked.windowStart = at('13:00');
      booked.windowEnd = at('15:00');
      const slot = s.assignments.find((a) => a.jobId === 'job_siti_2')!;
      slot.windowStart = at('13:00');
      slot.windowEnd = at('14:15');
      s.technicians.find((t) => t.id === 'tech_jonah')!.parts = [];
    });

    for (const profile of PROFILES) {
      const plan = plans[profile];
      expect(plan.validations.violations, `${profile} violations`).toEqual([]);
      expect(slotOf(plan, 'job_raffles')?.technicianId).toBe('tech_siti');
      const moved = slotOf(plan, 'job_siti_2')!;
      expect(moved.technicianId).not.toBe('tech_siti');
      expect(`${moved.windowStart}-${moved.windowEnd}`).toBe(live.get('job_siti_2')!.split(' ')[1]);
      expect(plan.metrics.jobsMoved).toBe(1);
      expect(plan.changeSet).toContainEqual(expect.objectContaining({ action: 'reassign', jobId: 'job_siti_2' }));
    }
  });

  it('gives the two profiles different objectives, not the same one scaled', async () => {
    const { plans } = await solve('technician_unavailable', { technicianId: 'tech_hafiz' }, ['tech_hafiz']);
    const trace = (p: CandidatePlan) => p.solverTrace as { objective: string };
    expect(trace(plans.sla_first).objective).toBe('soonest_service');
    expect(trace(plans.minimal_disruption).objective).toBe('least_knock_on');
  });
});
