/**
 * G-09: the finals board plans legally.
 *
 * The live desk runs on `buildScenario(today)`, not the 12-job Eastwind
 * fixture. This file holds the seeded board and the three demo events to the
 * same bar the Eastwind board is held to.
 *
 * Offline it runs the insertion fallback. With the sidecar up it also requires
 * OR-Tools to answer, inside the 10-second budget:
 *
 *   RUN_SIDECAR_ACCEPTANCE=1 OPTIMIZER_URL=http://localhost:8081 npx vitest run evals/g-suite/g09-finals-scenario.test.ts
 */
import { describe, expect, it } from 'vitest';
import { InMemoryDatabase } from '../../src/db/memory';
import { buildBoardSchedule } from '../../src/dispatch/board-schedule';
import { commitPlan } from '../../src/dispatch/commit';
import { getCurrentBoard } from '../../src/dispatch/current-board';
import { recordDecision } from '../../src/dispatch/decision';
import type { IDatabase } from '../../src/db/interface';
import { proposeWithSidecar } from '../../src/matching/propose';
import { validatePlan } from '../../src/matching/validate';
import { addDays } from '../../src/shared/config/demo';
import { buildScenario } from '../../src/shared/fixtures/scenario';
import type { CandidatePlan, OperationalEventType, PlanProfile } from '../../src/shared/types/domain';

const DATE = '2026-10-20';
const sidecar = process.env.RUN_SIDECAR_ACCEPTANCE === '1';
const PROFILES: PlanProfile[] = ['sla_first', 'minimal_disruption'];

function finalsDb() {
  return new InMemoryDatabase({ scenario: () => buildScenario(DATE) });
}

async function solve(
  type: OperationalEventType,
  payload: Record<string, unknown>,
  affected: string[],
  db: IDatabase = finalsDb(),
) {
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
  const plans = {} as Record<PlanProfile, CandidatePlan>;
  const engines: string[] = [];
  for (const profile of PROFILES) {
    const started = Date.now();
    const out = await proposeWithSidecar({ event, schedule, profile });
    expect(Date.now() - started, `${profile} inside the 10 s budget`).toBeLessThan(10_000);
    // The sidecar answers one profile per call; insertion returns both at once.
    const plan = out.plans.find((p) => p.profile === profile);
    expect(plan, `${profile} produced a plan (${out.message ?? 'no message'})`).toBeDefined();
    engines.push(out.engine ?? 'insertion');
    plans[profile] = plan!;
  }
  return { db, event, schedule, plans, engines };
}

/** Store both plans, approve one, and commit it through the real write path. */
async function approveAndCommit(
  db: IDatabase,
  eventId: string,
  sourceSnapshotId: string,
  plans: Record<PlanProfile, CandidatePlan>,
  chosen: PlanProfile,
) {
  const proposal = await db.proposals.create({
    eventId, sourceSnapshotId, risk: 'medium', autonomyMode: 'approval', status: 'RECOMMENDED',
  });
  let planId = '';
  for (const profile of PROFILES) {
    const plan = plans[profile];
    const saved = await db.candidatePlans.create({
      proposalId: proposal.id, sourceSnapshotId, profile, assignments: plan.assignments, changeSet: plan.changeSet,
      metrics: plan.metrics, validations: plan.validations, solverTrace: plan.solverTrace,
      timedOut: plan.timedOut, durationMs: plan.durationMs, status: 'VALIDATED',
    });
    if (profile === chosen) planId = saved.id;
  }
  const decision = await recordDecision(db, {
    proposalId: proposal.id, decision: 'approved', planId, reason: 'rehearsal', actorId: 'user_desk',
  });
  expect(decision.ok).toBe(true);
  const committed = await commitPlan(db, { proposalId: proposal.id, planId, sourceSnapshotId, actorId: 'user_desk' });
  expect(committed.ok, JSON.stringify(committed)).toBe(true);
}

function signature(plan: CandidatePlan) {
  return plan.assignments
    .map((a) => `${a.jobId}:${a.technicianId}@${a.windowStart}`)
    .sort()
    .join('|');
}

describe('G-09 finals board', () => {
  it('plans against its own day and ignores tomorrow', async () => {
    const schedule = await buildBoardSchedule(finalsDb());
    expect(schedule.date).toBe(DATE);
    expect(schedule.jobs.every((j) => j.scheduledDate === DATE)).toBe(true);
    const ids = new Set(schedule.jobs.map((j) => j.id));
    expect(schedule.assignments.every((a) => ids.has(a.jobId))).toBe(true);
    expect(schedule.assignments.length).toBe(schedule.jobs.length - 1); // Raffles is unassigned
  });

  it('seeds a board the validator accepts as it stands', async () => {
    const schedule = await buildBoardSchedule(finalsDb());
    const asIs = {
      assignments: schedule.assignments.map((a) => ({
        jobId: a.jobId,
        technicianId: a.technicianId,
        windowStart: a.windowStart,
        windowEnd: a.windowEnd,
      })),
    } as CandidatePlan;
    expect(validatePlan(asIs, schedule).violations).toEqual([]);
  });

  it('shows tomorrow on request without changing the board day', async () => {
    const db = finalsDb();
    const ahead = await getCurrentBoard(db, addDays(DATE, 1));
    expect(ahead.date).toBe(addDays(DATE, 1));
    expect(ahead.today).toBe(DATE);
    expect(ahead.jobs.length).toBeGreaterThanOrEqual(15);
    expect(ahead.jobs.every((row) => row.assignment)).toBe(true);
    expect((await getCurrentBoard(db)).date).toBe(DATE);
  });

  const events: Array<[string, OperationalEventType, Record<string, unknown>, string[]]> = [
    ['urgent Raffles Place', 'urgent_job', { jobId: 'job_raffles' }, ['job_raffles']],
    ['Hafiz off sick', 'technician_unavailable', { technicianId: 'tech_hafiz' }, ['tech_hafiz']],
    ['Hafiz 90 minutes over', 'job_overrun', { jobId: 'job_hafiz_1', overrunMinutes: 90 }, ['job_hafiz_1']],
  ];

  for (const [name, type, payload, affected] of events) {
    it(`plans ${name} legally on both profiles`, async () => {
      const { plans, engines } = await solve(type, payload, affected);
      if (sidecar) expect(engines, 'the sidecar must answer').toEqual(['ortools', 'ortools']);
      for (const profile of PROFILES) {
        expect(plans[profile].validations.violations, `${profile} violations`).toEqual([]);
      }
      if (type === 'urgent_job') {
        for (const profile of PROFILES) {
          const slot = plans[profile].assignments.find((a) => a.jobId === 'job_raffles');
          expect(['tech_siti', 'tech_jonah']).toContain(slot?.technicianId);
        }
      }
      if (type === 'technician_unavailable') {
        for (const profile of PROFILES) {
          const kept = plans[profile].assignments.filter((a) => a.technicianId === 'tech_hafiz').map((a) => a.jobId);
          expect(kept).toEqual(['job_hafiz_1']);
        }
      }
    });
  }

  for (const chosen of PROFILES) {
    it(`still covers Hafiz's sick call after Raffles Place is committed with ${chosen}`, async () => {
      // The 12-job board needed the demo to approve one Raffles option first,
      // or the sick call that followed had no legal plan. This board must not.
      const first = await solve('urgent_job', { jobId: 'job_raffles' }, ['job_raffles']);
      await approveAndCommit(first.db, first.event.id, first.schedule.snapshotId, first.plans, chosen);

      const { plans, schedule } = await solve('technician_unavailable', { technicianId: 'tech_hafiz' }, ['tech_hafiz'], first.db);
      expect(schedule.snapshotVersion).toBe(2);
      expect(schedule.assignments.some((a) => a.jobId === 'job_raffles')).toBe(true);
      for (const profile of PROFILES) {
        expect(plans[profile].validations.violations, `${profile} violations`).toEqual([]);
      }
    });
  }

  it.skipIf(!sidecar)('gives the coordinator a real choice on every demo event', async () => {
    for (const [, type, payload, affected] of events) {
      const { plans } = await solve(type, payload, affected);
      expect(signature(plans.sla_first), `${type}: profiles should differ`).not.toBe(signature(plans.minimal_disruption));
    }
  });
});
