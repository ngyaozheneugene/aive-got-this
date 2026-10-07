/**
 * G-10: a technician unavailable for part of the day, and a job running late
 * by any amount, on the finals board.
 *
 * Offline it runs the insertion fallback. With the sidecar up it requires
 * OR-Tools to answer:
 *
 *   RUN_SIDECAR_ACCEPTANCE=1 OPTIMIZER_URL=http://localhost:8081 npx vitest run evals/g-suite/g10-partial-unavailability.test.ts
 */
import { describe, expect, it, vi } from 'vitest';
import { InMemoryDatabase } from '../../src/db/memory';
import type { IDatabase } from '../../src/db/interface';
import { buildBoardSchedule } from '../../src/dispatch/board-schedule';
import { commitPlan } from '../../src/dispatch/commit';
import { recordDecision } from '../../src/dispatch/decision';
import { applyDisruption } from '../../src/matching/disruption';
import { proposeWithSidecar } from '../../src/matching/propose';
import { buildScenario } from '../../src/shared/fixtures/scenario';
import type { CandidatePlan, OperationalEventType, PlanProfile } from '../../src/shared/types/domain';

const DATE = '2026-10-20';
const at = (hhmm: string) => `${DATE}T${hhmm}:00+08:00`;
const sidecar = process.env.RUN_SIDECAR_ACCEPTANCE === '1';
const PROFILES: PlanProfile[] = ['sla_first', 'minimal_disruption'];

async function solve(
  type: OperationalEventType,
  payload: Record<string, unknown>,
  affected: string[],
  db: IDatabase = new InMemoryDatabase({ scenario: () => buildScenario(DATE) }),
) {
  const board = await buildBoardSchedule(db);
  const event = await db.events.create({
    type, rawText: '', normalizedPayload: payload, sourceSnapshotId: board.snapshotId,
    affectedIds: affected, validationIssues: [], status: 'VALIDATED',
  });
  const schedule = applyDisruption(board, event);
  const plans = {} as Record<PlanProfile, CandidatePlan>;
  for (const profile of PROFILES) {
    const out = await proposeWithSidecar({ event, schedule: board, profile });
    if (sidecar) expect(out.engine, 'the sidecar must answer').toBe('ortools');
    const plan = out.plans.find((p) => p.profile === profile);
    expect(plan, `${profile}: ${out.message ?? 'no plan'}`).toBeDefined();
    expect(plan!.validations.violations, `${profile} violations`).toEqual([]);
    plans[profile] = plan!;
  }
  return { db, event, board, schedule, plans };
}

const jobsOf = (plan: CandidatePlan, tech: string) =>
  plan.assignments.filter((a) => a.technicianId === tech).map((a) => a.jobId).sort();

// Each plan has a 10 s budget (asserted above); two profiles plus setup need headroom.
vi.setConfig({ testTimeout: 30_000 });

describe('G-10 part-day unavailability and any-length overruns', () => {
  it('Kumar out until 14:00: his morning and 13:00 jobs move, his 15:30 stays', async () => {
    const { plans } = await solve('technician_unavailable', { technicianId: 'tech_kumar', until: at('14:00') }, ['tech_kumar']);
    for (const profile of PROFILES) {
      const kumar = plans[profile].assignments.filter((a) => a.technicianId === 'tech_kumar');
      expect(kumar.every((a) => Date.parse(a.windowStart!) >= Date.parse(at('14:00'))), profile).toBe(true);
      expect(kumar.map((a) => a.jobId), profile).toContain('job_kumar_3');
    }
  });

  it('Kumar leaving at 15:00: only his 15:30 moves', async () => {
    const { plans } = await solve('technician_unavailable', { technicianId: 'tech_kumar', from: at('15:00') }, ['tech_kumar']);
    for (const profile of PROFILES) {
      expect(jobsOf(plans[profile], 'tech_kumar'), profile).toEqual(['job_kumar_1', 'job_kumar_2']);
      expect(plans[profile].metrics.jobsMoved, profile).toBeGreaterThanOrEqual(1);
    }
  });

  it('a 20-minute overrun is absorbed and a 150-minute one moves work', async () => {
    const small = await solve('job_overrun', { jobId: 'job_hafiz_1', overrunMinutes: 20 }, ['job_hafiz_1']);
    for (const profile of PROFILES) expect(small.plans[profile].metrics.jobsMoved, profile).toBe(0);
    const big = await solve('job_overrun', { jobId: 'job_hafiz_1', overrunMinutes: 150 }, ['job_hafiz_1']);
    for (const profile of PROFILES) expect(big.plans[profile].metrics.jobsMoved, profile).toBeGreaterThanOrEqual(1);
  });

  it('a committed part-day absence stays on the board for the next event', async () => {
    const first = await solve('technician_unavailable', { technicianId: 'tech_kumar', from: at('15:00') }, ['tech_kumar']);
    const proposal = await first.db.proposals.create({
      eventId: first.event.id, sourceSnapshotId: first.board.snapshotId, risk: 'medium', autonomyMode: 'approval', status: 'RECOMMENDED',
    });
    const plan = first.plans.sla_first;
    const saved = await first.db.candidatePlans.create({
      proposalId: proposal.id, sourceSnapshotId: first.board.snapshotId, profile: plan.profile, assignments: plan.assignments,
      changeSet: plan.changeSet, metrics: plan.metrics, validations: plan.validations, solverTrace: plan.solverTrace,
      timedOut: plan.timedOut, durationMs: plan.durationMs, status: 'VALIDATED',
    });
    expect((await recordDecision(first.db, { proposalId: proposal.id, decision: 'approved', planId: saved.id, reason: 'ok', actorId: 'desk' })).ok).toBe(true);
    const done = await commitPlan(first.db, { proposalId: proposal.id, planId: saved.id, sourceSnapshotId: first.board.snapshotId, actorId: 'desk' });
    expect(done.ok, JSON.stringify(done)).toBe(true);

    const shift = await first.db.shifts.getByTechAndDate('tech_kumar', DATE);
    expect(shift?.clockOutAt).toBe(at('15:00'));
    expect(shift?.status).toBe('clocked_in');

    // The urgent job that follows cannot put Kumar after 15:00.
    const next = await solve('urgent_job', { jobId: 'job_raffles' }, ['job_raffles'], first.db);
    for (const profile of PROFILES) {
      const late = next.plans[profile].assignments.filter(
        (a) => a.technicianId === 'tech_kumar' && Date.parse(a.windowEnd!) > Date.parse(at('15:00')),
      );
      expect(late, profile).toEqual([]);
    }
  });

  it('a committed sick day marks the shift, so nothing new lands on them', async () => {
    const first = await solve('technician_unavailable', { technicianId: 'tech_hafiz' }, ['tech_hafiz']);
    const proposal = await first.db.proposals.create({
      eventId: first.event.id, sourceSnapshotId: first.board.snapshotId, risk: 'medium', autonomyMode: 'approval', status: 'RECOMMENDED',
    });
    const plan = first.plans.minimal_disruption;
    const saved = await first.db.candidatePlans.create({
      proposalId: proposal.id, sourceSnapshotId: first.board.snapshotId, profile: plan.profile, assignments: plan.assignments,
      changeSet: plan.changeSet, metrics: plan.metrics, validations: plan.validations, solverTrace: plan.solverTrace,
      timedOut: plan.timedOut, durationMs: plan.durationMs, status: 'VALIDATED',
    });
    await recordDecision(first.db, { proposalId: proposal.id, decision: 'approved', planId: saved.id, reason: 'ok', actorId: 'desk' });
    expect((await commitPlan(first.db, { proposalId: proposal.id, planId: saved.id, sourceSnapshotId: first.board.snapshotId, actorId: 'desk' })).ok).toBe(true);
    expect((await first.db.shifts.getByTechAndDate('tech_hafiz', DATE))?.status).toBe('mc');

    // His on-site job is still his and still legal; a later overrun on it plans.
    const next = await solve('job_overrun', { jobId: 'job_hafiz_1', overrunMinutes: 30 }, ['job_hafiz_1'], first.db);
    for (const profile of PROFILES) {
      expect(jobsOf(next.plans[profile], 'tech_hafiz'), profile).toEqual(['job_hafiz_1']);
    }
  });
});
