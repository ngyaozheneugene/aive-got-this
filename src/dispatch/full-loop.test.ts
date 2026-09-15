// The seam between stream 2 (propose) and stream 1 (store, decide, commit).
//
// Every stream's own tests passed while the joined-up path was broken, because
// nobody's tests crossed the boundary: propose() was tested with hand-built
// schedules, and the commit path with hand-built proposals. These tests run the
// real chain - board -> propose -> save -> decide -> commit - on the real fixture.

import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryDatabase } from '../db/memory';
import { buildBoardSchedule } from './board-schedule';
import { commitPlan } from './commit';
import { getCurrentBoard } from './current-board';
import { recordDecision } from './decision';
import { propose } from '../matching/propose';
import { EASTWIND_DATE } from '../shared/config/demo';
import type { IDatabase } from '../db/interface';

describe('buildBoardSchedule', () => {
  let db: IDatabase;
  beforeEach(() => {
    db = new InMemoryDatabase();
  });

  it('reads live assignment rows, not the snapshot blob', async () => {
    const schedule = await buildBoardSchedule(db);

    // The seeded v1 snapshot's snapshotData holds only assignment *ids*, so a
    // blob-based build would produce an empty board here.
    expect(schedule.assignments.length).toBeGreaterThan(0);
    expect(schedule.technicians).toHaveLength(6);
    expect(schedule.jobs).toHaveLength(12);
    expect(schedule.date).toBe(EASTWIND_DATE);
    expect(schedule.snapshotVersion).toBe(1);
  });

  it('supplies a travel matrix, so travelMinutes cannot throw', async () => {
    const schedule = await buildBoardSchedule(db);
    expect(schedule.travel.length).toBeGreaterThan(0);
  });

  it('supplies certs, shifts and requirements rather than letting propose() fall back to the fixture', async () => {
    const schedule = await buildBoardSchedule(db);
    expect(schedule.certs.length).toBeGreaterThan(0);
    expect(schedule.shifts.length).toBeGreaterThan(0);
    expect(schedule.jobRequirements.length).toBeGreaterThan(0);
  });

  it('excludes superseded rows from the board', async () => {
    const before = await buildBoardSchedule(db);
    const target = before.assignments[0]!;

    await db.assignments.supersede(target.id, 'reassigned');

    const after = await buildBoardSchedule(db);
    expect(after.assignments.map((a) => a.id)).not.toContain(target.id);
    expect(after.assignments).toHaveLength(before.assignments.length - 1);
  });
});

describe('event -> propose -> decide -> commit, on the real fixture', () => {
  let db: IDatabase;
  beforeEach(() => {
    db = new InMemoryDatabase();
  });

  it('runs the whole loop and lands Raffles Place on a legal technician', async () => {
    const snapshot = await db.boardSnapshots.getLatest();

    const event = await db.events.create({
      type: 'urgent_job',
      rawText: '',
      normalizedPayload: { jobId: 'job_raffles' },
      sourceSnapshotId: snapshot!.id,
      affectedIds: ['job_raffles'],
      validationIssues: [],
      status: 'VALIDATED',
    });

    // 1. propose against the real board. Must not throw, must return plans.
    const schedule = await buildBoardSchedule(db);
    const output = propose({ event, schedule, profile: 'sla_first' });

    expect(output.message).toBeUndefined();
    expect(output.plans.length).toBeGreaterThanOrEqual(2);
    expect(output.engine).toBe('insertion');

    // Two profiles, both validated.
    expect(output.plans.map((p) => p.profile).sort()).toEqual([
      'minimal_disruption',
      'sla_first',
    ]);
    for (const plan of output.plans) {
      expect(plan.validations.ok).toBe(true);
    }

    // Wei is the nearest van and is not certified; he must not be proposed.
    for (const plan of output.plans) {
      const raffles = plan.assignments.find((s) => s.jobId === 'job_raffles');
      expect(raffles).toBeDefined();
      expect(raffles!.technicianId).not.toBe('tech_wei');
    }

    // 2. store, recording the recommendation from the SAVED id.
    const proposal = await db.proposals.create({
      eventId: event.id,
      sourceSnapshotId: schedule.snapshotId,
      risk: 'medium',
      autonomyMode: 'approval',
      status: 'RECOMMENDED',
    });

    let recommendedId: string | undefined;
    for (const plan of output.plans) {
      const saved = await db.candidatePlans.create({
        proposalId: proposal.id,
        sourceSnapshotId: schedule.snapshotId,
        profile: plan.profile,
        assignments: plan.assignments,
        changeSet: plan.changeSet,
        metrics: plan.metrics,
        validations: plan.validations,
        solverTrace: plan.solverTrace,
        timedOut: plan.timedOut,
        durationMs: plan.durationMs,
        status: plan.status === 'RECOMMENDED' ? 'RECOMMENDED' : 'VALIDATED',
      });
      if (saved.status === 'RECOMMENDED') recommendedId = saved.id;
    }
    await db.proposals.updateStatus(proposal.id, 'RECOMMENDED', recommendedId);

    // The recommendation must name a row that actually exists.
    const stored = await db.proposals.getById(proposal.id);
    expect(stored?.recommendedPlanId).toBeDefined();
    await expect(
      db.candidatePlans.getById(stored!.recommendedPlanId!),
    ).resolves.not.toBeNull();

    // 3. medium risk: no commit before the desk decides.
    const refused = await commitPlan(db, {
      proposalId: proposal.id,
      planId: stored!.recommendedPlanId!,
      sourceSnapshotId: schedule.snapshotId,
      actorId: 'user_desk',
    });
    expect(refused).toMatchObject({ ok: false, code: 'approval_required' });

    // 4. approve with no planId - the desk's common action, which relies on the
    //    recommendation resolving.
    const decision = await recordDecision(db, {
      proposalId: proposal.id,
      decision: 'approved',
      reason: 'Raffles Place SLA at risk.',
      actorId: 'user_desk',
    });
    expect(decision.ok).toBe(true);

    // 5. commit.
    const committed = await commitPlan(db, {
      proposalId: proposal.id,
      planId: stored!.recommendedPlanId!,
      sourceSnapshotId: schedule.snapshotId,
      actorId: 'user_desk',
    });
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    expect(committed.snapshot.version).toBe(2);

    // propose() hands back the whole day; only the one genuinely new assignment
    // should have been written.
    expect(committed.appliedSlots).toHaveLength(1);
    expect(committed.appliedSlots[0]?.jobId).toBe('job_raffles');

    // 6. the board moved, and Raffles Place has a technician.
    const board = await getCurrentBoard(db);
    expect(board.snapshot.version).toBe(2);
    const rafflesRow = board.jobs.find((j) => j.job.id === 'job_raffles');
    expect(rafflesRow?.technician).toBeDefined();
    expect(rafflesRow?.technician?.id).not.toBe('tech_wei');

    // 7. no job ends up on two technicians.
    const live = (await db.assignments.listAll()).filter(
      (a) => a.status === 'accepted' || a.status === 'offered',
    );
    const perJob = new Map<string, number>();
    for (const a of live) perJob.set(a.jobId, (perJob.get(a.jobId) ?? 0) + 1);
    expect([...perJob.values()].filter((n) => n > 1)).toHaveLength(0);

    // 8. the trail reads in order.
    const trail = await db.decisionLogs.listByEvent(event.id);
    expect(trail.map((e) => e.eventType)).toEqual(['desk_decision', 'commit']);
  });

  it('does not depend on today being the fixture date', async () => {
    // The plan route derived the job date from event.receivedAt - the wall
    // clock - so it only found jobs on the one day the fixture happens to name.
    const schedule = await buildBoardSchedule(db);
    expect(schedule.date).toBe(EASTWIND_DATE);
    expect(schedule.jobs.length).toBeGreaterThan(0);
  });
});
