/**
 * G-12: partial coverage. When nobody can legally take a job, the plan covers
 * everything else and names that job for a call, instead of no plan at all.
 *
 *   RUN_SIDECAR_ACCEPTANCE=1 OPTIMIZER_URL=http://localhost:8081 npx vitest run evals/g-suite/g12-partial-coverage.test.ts
 */
import { describe, expect, it, vi } from 'vitest';
import { InMemoryDatabase } from '../../src/db/memory';
import type { IDatabase } from '../../src/db/interface';
import { buildBoardSchedule } from '../../src/dispatch/board-schedule';
import { commitPlan } from '../../src/dispatch/commit';
import { getCurrentBoard } from '../../src/dispatch/current-board';
import { recordDecision } from '../../src/dispatch/decision';
import { classifyProposalRisk } from '../../src/agent/policy/risk';
import { proposeWithSidecar } from '../../src/matching/propose';
import { unassignedOf } from '../../src/matching/unassigned';
import { buildScenario } from '../../src/shared/fixtures/scenario';
import type { CandidatePlan, OperationalEventType, PlanProfile } from '../../src/shared/types/domain';

const DATE = '2026-10-20';
const sidecar = process.env.RUN_SIDECAR_ACCEPTANCE === '1';
const PROFILES: PlanProfile[] = ['sla_first', 'minimal_disruption'];

vi.setConfig({ testTimeout: 30_000 });

async function solve(type: OperationalEventType, payload: Record<string, unknown>, affected: string[]) {
  const db: IDatabase = new InMemoryDatabase({ scenario: () => buildScenario(DATE) });
  const schedule = await buildBoardSchedule(db);
  const event = await db.events.create({
    type, rawText: '', normalizedPayload: payload, sourceSnapshotId: schedule.snapshotId,
    affectedIds: affected, validationIssues: [], status: 'VALIDATED',
  });
  const plans = {} as Record<PlanProfile, CandidatePlan>;
  for (const profile of PROFILES) {
    const out = await proposeWithSidecar({ event, schedule, profile });
    if (sidecar) expect(out.engine, 'the sidecar must answer').toBe('ortools');
    const plan = out.plans.find((p) => p.profile === profile);
    expect(plan, `${profile}: ${out.message ?? 'no plan'}`).toBeDefined();
    expect(plan!.validations.violations, `${profile} violations`).toEqual([]);
    plans[profile] = plan!;
  }
  return { db, schedule, event, plans };
}

describe('G-12 partial coverage', () => {
  it('Mei off sick: the promised clinic slot can only be hers, so it is left for a call and the rest move', async () => {
    const { plans, schedule } = await solve('technician_unavailable', { technicianId: 'tech_mei' }, ['tech_mei']);
    for (const profile of PROFILES) {
      const plan = plans[profile];
      const left = unassignedOf(plan);
      expect(left.find((u) => u.jobId === 'job_mei_sla'), profile).toMatchObject({ reason: 'promised' });
      expect(plan.metrics.unassignedCount, profile).toBe(left.length);
      expect(plan.assignments.filter((a) => a.technicianId === 'tech_mei'), profile).toEqual([]);
      // Her other jobs are covered by someone.
      for (const job of ['job_mei_am', 'job_mei_2']) {
        expect(plan.assignments.some((a) => a.jobId === job) || left.some((u) => u.jobId === job), job).toBe(true);
      }
      expect(classifyProposalRisk({ plans: [plan], liveAssignments: schedule.assignments }))
        .toMatchObject({ risk: 'medium', autonomyMode: 'approval', reasons: expect.arrayContaining(['unassigned_jobs']) });
    }
  });

  it('Siti off sick: what fits moves, what does not is named with its reason', async () => {
    const { plans } = await solve('technician_unavailable', { technicianId: 'tech_siti' }, ['tech_siti']);
    for (const profile of PROFILES) {
      const left = unassignedOf(plans[profile]);
      expect(left.length, profile).toBeGreaterThan(0);
      for (const u of left) {
        expect(['no_time', 'no_legal_technician', 'promised']).toContain(u.reason);
        expect(u.fromTechnicianId).toBe('tech_siti');
      }
    }
  });

  it('a long overrun on a job not seeded as on site still plans legally', async () => {
    const { plans } = await solve('job_overrun', { jobId: 'job_marcus_1', overrunMinutes: 180 }, ['job_marcus_1']);
    for (const profile of PROFILES) {
      const own = plans[profile].assignments.find((a) => a.jobId === 'job_marcus_1')!;
      expect(own.technicianId).toBe('tech_marcus');
      expect(own.windowEnd).toBe(`${DATE}T13:30:00+08:00`);
    }
  });

  it('committing it cancels the booking and puts the job back with the waiting ones', async () => {
    const { db, schedule, event, plans } = await solve('technician_unavailable', { technicianId: 'tech_mei' }, ['tech_mei']);
    const plan = plans.minimal_disruption;
    const proposal = await db.proposals.create({
      eventId: event.id, sourceSnapshotId: schedule.snapshotId, risk: 'medium', autonomyMode: 'approval', status: 'RECOMMENDED',
    });
    const saved = await db.candidatePlans.create({
      proposalId: proposal.id, sourceSnapshotId: schedule.snapshotId, profile: plan.profile, assignments: plan.assignments,
      changeSet: plan.changeSet, metrics: plan.metrics, validations: plan.validations, solverTrace: plan.solverTrace,
      timedOut: plan.timedOut, durationMs: plan.durationMs, status: 'VALIDATED',
    });
    expect((await recordDecision(db, { proposalId: proposal.id, decision: 'approved', planId: saved.id, reason: 'ok', actorId: 'desk' })).ok).toBe(true);
    const done = await commitPlan(db, { proposalId: proposal.id, planId: saved.id, sourceSnapshotId: schedule.snapshotId, actorId: 'desk' });
    expect(done.ok, JSON.stringify(done)).toBe(true);

    const board = await getCurrentBoard(db);
    const clinic = board.jobs.find((r) => r.job.id === 'job_mei_sla')!;
    expect(clinic.assignment).toBeUndefined();
    expect(clinic.job.status).toBe('unassigned');
    expect(board.jobs.filter((r) => !r.assignment).map((r) => r.job.id)).toEqual(expect.arrayContaining(['job_raffles', 'job_mei_sla']));
    expect((await db.assignments.getByJobId('job_mei_sla')).map((a) => a.status)).toEqual(['cancelled']);
    expect((await db.statusEvents.getByJobId('job_mei_sla')).at(-1)).toMatchObject({ toStatus: 'unassigned', reason: expect.stringMatching(/^partial_coverage:/) });
    const snapshot = await db.boardSnapshots.getLatest();
    const slots = (snapshot!.snapshotData as { assignments: Array<{ jobId: string }> }).assignments;
    expect(slots.some((s) => s.jobId === 'job_mei_sla')).toBe(false);
  });
});
