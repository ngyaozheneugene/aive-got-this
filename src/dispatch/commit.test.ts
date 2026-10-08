// G2 end to end, against the adapter the app actually runs on.
// event → proposal → decision → commit → new snapshot → audit trail.

import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryDatabase } from '../db/memory';
import { getCurrentBoard } from './current-board';
import { commitPlan } from './commit';
import { recordDecision } from './decision';
import type { IDatabase } from '../db/interface';
import type { AutonomyMode, PlannedSlot, RiskLevel } from '../shared/types/domain';

const RAFFLES_TO_SITI: PlannedSlot[] = [
  { jobId: 'job_raffles', technicianId: 'tech_siti', windowStart: '2026-09-15T14:00:00+08:00' },
];

async function seedProposal(
  db: IDatabase,
  opts: { risk: RiskLevel; autonomyMode: AutonomyMode; slots?: PlannedSlot[] },
) {
  const snapshot = await db.boardSnapshots.getLatest();
  if (!snapshot) throw new Error('fixture has no snapshot');

  const event = await db.events.create({
    type: 'urgent_job',
    rawText: '',
    normalizedPayload: { jobId: 'job_raffles' },
    sourceSnapshotId: snapshot.id,
    affectedIds: ['job_raffles'],
    validationIssues: [],
    status: 'PLANNING',
  });

  const proposal = await db.proposals.create({
    eventId: event.id,
    sourceSnapshotId: snapshot.id,
    risk: opts.risk,
    autonomyMode: opts.autonomyMode,
    status: 'RECOMMENDED',
  });

  const plan = await db.candidatePlans.create({
    proposalId: proposal.id,
    sourceSnapshotId: snapshot.id,
    profile: 'sla_first',
    assignments: opts.slots ?? RAFFLES_TO_SITI,
    changeSet: [],
    metrics: {
      slaLatenessMinutes: 0,
      travelMinutes: 25,
      overtimeMinutes: 0,
      jobsMoved: 1,
      customersAffected: 1,
      unassignedCount: 0,
    },
    validations: { ok: true, violations: [] },
    solverTrace: { engine: 'insertion' },
    timedOut: false,
    status: 'VALIDATED',
  });

  await db.proposals.updateStatus(proposal.id, 'RECOMMENDED', plan.id);
  const ready = await db.proposals.getById(proposal.id);
  return { event, proposal: ready!, plan, snapshot };
}

describe('commitPlan — the happy path', () => {
  let db: IDatabase;
  beforeEach(() => {
    db = new InMemoryDatabase();
  });

  it('commits a low-risk plan and moves the board to a new version', async () => {
    const { event, proposal, plan, snapshot } = await seedProposal(db, {
      risk: 'low',
      autonomyMode: 'auto',
    });

    const before = await getCurrentBoard(db);
    expect(before.snapshot.version).toBe(1);
    expect(before.jobs.find((j) => j.job.id === 'job_raffles')?.technician).toBeUndefined();

    const result = await commitPlan(db, {
      proposalId: proposal.id,
      planId: plan.id,
      sourceSnapshotId: snapshot.id,
      actorId: 'user_desk',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.version).toBe(2);
    expect(result.snapshot.sourceSnapshotId).toBe(snapshot.id);
    expect(result.snapshot.triggerEventId).toBe(event.id);

    const after = await getCurrentBoard(db);
    expect(after.snapshot.version).toBe(2);
    expect(after.jobs.find((j) => j.job.id === 'job_raffles')?.technician?.id).toBe('tech_siti');
    // The job itself now says it is assigned, not just its assignment row.
    expect(after.jobs.find((j) => j.job.id === 'job_raffles')?.job.status).toBe('assigned');

    expect((await db.proposals.getById(proposal.id))?.status).toBe('COMMITTED');
    expect((await db.events.getById(event.id))?.status).toBe('COMMITTED');
  });

  it('supersedes the old assignment when a job moves technician', async () => {
    const { proposal, plan, snapshot } = await seedProposal(db, {
      risk: 'low',
      autonomyMode: 'auto',
      slots: [{ jobId: 'job_wei_1', technicianId: 'tech_siti' }],
    });

    const before = await getCurrentBoard(db);
    expect(before.jobs.find((j) => j.job.id === 'job_wei_1')?.technician?.id).toBe('tech_wei');

    await commitPlan(db, {
      proposalId: proposal.id,
      planId: plan.id,
      sourceSnapshotId: snapshot.id,
      actorId: 'user_desk',
    });

    const after = await getCurrentBoard(db);
    // Exactly one technician, not two.
    expect(after.jobs.find((j) => j.job.id === 'job_wei_1')?.technician?.id).toBe('tech_siti');
    const wei = after.technicians.find((t) => t.technician.id === 'tech_wei');
    expect(wei?.assignedJobIds).not.toContain('job_wei_1');
  });

  it('writes an audit entry the audit endpoint can read back', async () => {
    const { event, proposal, plan, snapshot } = await seedProposal(db, {
      risk: 'low',
      autonomyMode: 'auto',
    });

    await commitPlan(db, {
      proposalId: proposal.id,
      planId: plan.id,
      sourceSnapshotId: snapshot.id,
      actorId: 'user_desk',
    });

    const trail = await db.decisionLogs.listByEvent(event.id);
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({ eventType: 'commit', result: 'committed' });
    expect(trail[0]?.summary).toContain('snapshot v2');
  });
});

describe('commitPlan — medium risk needs a recorded approval (UC-12)', () => {
  let db: IDatabase;
  beforeEach(() => {
    db = new InMemoryDatabase();
  });

  it('refuses before the desk decides, then commits after approval', async () => {
    const { event, proposal, plan, snapshot } = await seedProposal(db, {
      risk: 'medium',
      autonomyMode: 'approval',
    });

    const refused = await commitPlan(db, {
      proposalId: proposal.id,
      planId: plan.id,
      sourceSnapshotId: snapshot.id,
      actorId: 'user_desk',
    });
    expect(refused).toMatchObject({ ok: false, code: 'approval_required', httpStatus: 403 });

    // The board must be untouched by a refused commit.
    expect((await getCurrentBoard(db)).snapshot.version).toBe(1);

    const decision = await recordDecision(db, {
      proposalId: proposal.id,
      decision: 'approved',
      reason: 'Customer accepted the later window.',
      actorId: 'user_desk',
    });
    expect(decision.ok).toBe(true);

    const committed = await commitPlan(db, {
      proposalId: proposal.id,
      planId: plan.id,
      sourceSnapshotId: snapshot.id,
      actorId: 'user_desk',
    });
    expect(committed.ok).toBe(true);

    // Decision and commit both appear in the trail, decision first.
    const trail = await db.decisionLogs.listByEvent(event.id);
    expect(trail.map((e) => e.eventType)).toEqual(['desk_decision', 'commit']);
  });

  it('refuses when the desk rejected the proposal', async () => {
    const { event, proposal, plan, snapshot } = await seedProposal(db, {
      risk: 'medium',
      autonomyMode: 'approval',
    });

    await recordDecision(db, {
      proposalId: proposal.id,
      decision: 'rejected',
      reason: 'Overtime not acceptable today.',
      actorId: 'user_desk',
    });

    expect((await db.events.getById(event.id))?.status).toBe('REJECTED');

    const result = await commitPlan(db, {
      proposalId: proposal.id,
      planId: plan.id,
      sourceSnapshotId: snapshot.id,
      actorId: 'user_desk',
    });
    expect(result).toMatchObject({ ok: false, code: 'proposal_rejected', httpStatus: 409 });
    expect((await getCurrentBoard(db)).snapshot.version).toBe(1);
  });

  it('approving one plan does not authorise committing another', async () => {
    const { proposal, plan, snapshot } = await seedProposal(db, {
      risk: 'medium',
      autonomyMode: 'approval',
    });
    const other = await db.candidatePlans.create({
      ...plan,
      profile: 'minimal_disruption',
    });

    await recordDecision(db, {
      proposalId: proposal.id,
      decision: 'approved',
      planId: plan.id,
      reason: 'SLA-first is the right trade today.',
      actorId: 'user_desk',
    });

    const result = await commitPlan(db, {
      proposalId: proposal.id,
      planId: other.id,
      sourceSnapshotId: snapshot.id,
      actorId: 'user_desk',
    });
    expect(result).toMatchObject({ ok: false, code: 'approval_required' });
  });
});

describe('commitPlan — snapshot protection (UC-07)', () => {
  it('refuses a proposal planned against a board that has since moved', async () => {
    const db = new InMemoryDatabase();
    const snapshot = await db.boardSnapshots.getLatest();

    // Two proposals race, both planned against v1.
    const first = await seedProposal(db, { risk: 'low', autonomyMode: 'auto' });
    const second = await seedProposal(db, {
      risk: 'low',
      autonomyMode: 'auto',
      slots: [{ jobId: 'job_raffles', technicianId: 'tech_kumar' }],
    });

    const won = await commitPlan(db, {
      proposalId: first.proposal.id,
      planId: first.plan.id,
      sourceSnapshotId: snapshot!.id,
      actorId: 'user_desk',
    });
    expect(won.ok).toBe(true);

    // The loser planned against v1, which is no longer the board.
    const lost = await commitPlan(db, {
      proposalId: second.proposal.id,
      planId: second.plan.id,
      sourceSnapshotId: snapshot!.id,
      actorId: 'user_desk',
    });
    expect(lost).toMatchObject({ ok: false, code: 'stale_snapshot', httpStatus: 409 });

    // Kumar never got the job; the first commit stands.
    const board = await getCurrentBoard(db);
    expect(board.jobs.find((j) => j.job.id === 'job_raffles')?.technician?.id).toBe('tech_siti');
    expect(board.snapshot.version).toBe(2);
  });

  it('refuses a second commit of the same proposal', async () => {
    const db = new InMemoryDatabase();
    const { proposal, plan, snapshot } = await seedProposal(db, {
      risk: 'low',
      autonomyMode: 'auto',
    });

    await commitPlan(db, {
      proposalId: proposal.id,
      planId: plan.id,
      sourceSnapshotId: snapshot.id,
      actorId: 'user_desk',
    });
    const again = await commitPlan(db, {
      proposalId: proposal.id,
      planId: plan.id,
      sourceSnapshotId: snapshot.id,
      actorId: 'user_desk',
    });

    expect(again).toMatchObject({ ok: false, code: 'already_committed' });
    // Still v2, not v3.
    expect((await getCurrentBoard(db)).snapshot.version).toBe(2);
  });
});

describe('commitPlan — high risk has no path (UC-02, UC-06)', () => {
  it('refuses even after someone records an approval', async () => {
    const db = new InMemoryDatabase();
    const { proposal, plan, snapshot } = await seedProposal(db, {
      risk: 'high',
      autonomyMode: 'block',
    });

    await recordDecision(db, {
      proposalId: proposal.id,
      decision: 'approved',
      reason: 'Desk tried to force it through.',
      actorId: 'user_desk',
    });

    const result = await commitPlan(db, {
      proposalId: proposal.id,
      planId: plan.id,
      sourceSnapshotId: snapshot.id,
      actorId: 'user_desk',
    });
    expect(result).toMatchObject({ ok: false, code: 'commit_blocked', httpStatus: 403 });
    expect((await getCurrentBoard(db)).snapshot.version).toBe(1);
  });
});

describe('demo reset is idempotent (UC-10)', () => {
  it('returns the same board no matter how many times it runs', async () => {
    const db = new InMemoryDatabase();
    const { proposal, plan, snapshot } = await seedProposal(db, {
      risk: 'low',
      autonomyMode: 'auto',
    });
    await commitPlan(db, {
      proposalId: proposal.id,
      planId: plan.id,
      sourceSnapshotId: snapshot.id,
      actorId: 'user_desk',
    });
    expect((await getCurrentBoard(db)).snapshot.version).toBe(2);

    const shapes: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      await db.reset();
      const board = await getCurrentBoard(db);
      shapes.push(
        JSON.stringify({
          version: board.snapshot.version,
          jobs: board.jobs.map((j) => [j.job.id, j.technician?.id ?? null]),
          load: board.technicians.map((t) => [t.technician.id, t.loadMinutes]),
        }),
      );
    }

    expect(new Set(shapes).size).toBe(1);
    expect(shapes[0]).toContain('"version":1');
    expect(shapes[0]).toContain('["job_raffles",null]');
  });
});
