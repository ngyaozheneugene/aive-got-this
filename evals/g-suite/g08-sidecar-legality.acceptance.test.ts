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

async function solve(type: OperationalEventType, payload: Record<string, unknown>, affected: string[]) {
  const db = new InMemoryDatabase();
  const schedule = await buildBoardSchedule(db);
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

  it('gives the two profiles different objectives, not the same one scaled', async () => {
    const { plans } = await solve('technician_unavailable', { technicianId: 'tech_hafiz' }, ['tech_hafiz']);
    const trace = (p: CandidatePlan) => p.solverTrace as { objective: string };
    expect(trace(plans.sla_first).objective).toBe('soonest_service');
    expect(trace(plans.minimal_disruption).objective).toBe('least_knock_on');
  });
});
