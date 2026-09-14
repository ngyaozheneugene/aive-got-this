// The write path. The single place in the codebase that calls
// boardSnapshots.createSnapshot, and it only gets there once checkCommit agrees.
//
// Split deliberately: commit-policy.ts decides (pure, no I/O), this file acts
// (I/O, no decisions). Neither re-derives what the other owns.

import { checkCommit } from './commit-policy';
import { getCurrentBoard } from './current-board';
import type { IDatabase } from '../db/interface';
import type {
  BoardSnapshot,
  CandidatePlan,
  PlannedSlot,
  Proposal,
} from '../shared/types/domain';

export interface CommitInput {
  proposalId: string;
  planId: string;
  /** The snapshot the caller believes it planned against. Checked, never trusted. */
  sourceSnapshotId: string;
  actorId: string;
}

export type CommitResult =
  | { ok: true; snapshot: BoardSnapshot; proposal: Proposal; appliedSlots: PlannedSlot[] }
  | { ok: false; code: string; httpStatus: number; detail: string };

/**
 * The slot set the board ends up with: everything currently live, with the
 * plan's slots overriding by job id.
 *
 * This treats `plan.assignments` as the slots the plan asserts, not the whole
 * day. Insertion (G1) asserts one; a solver replan (G3) asserts several. Jobs
 * the plan does not mention keep the technician they have.
 */
function resultingSlots(
  liveSlots: PlannedSlot[],
  planSlots: PlannedSlot[],
): PlannedSlot[] {
  const byJob = new Map<string, PlannedSlot>();
  for (const slot of liveSlots) byJob.set(slot.jobId, slot);
  for (const slot of planSlots) byJob.set(slot.jobId, slot);
  return Array.from(byJob.values());
}

export async function commitPlan(db: IDatabase, input: CommitInput): Promise<CommitResult> {
  const proposal = await db.proposals.getById(input.proposalId);
  const plan = await db.candidatePlans.getById(input.planId);
  const approval = proposal ? await db.approvals.getByProposal(proposal.id) : null;
  const latest = await db.boardSnapshots.getLatest();

  const verdict = checkCommit({
    proposal,
    plan,
    approval,
    latestSnapshotId: latest?.id ?? '',
    requestedSourceSnapshotId: input.sourceSnapshotId,
  });

  if (!verdict.ok) {
    return { ok: false, code: verdict.code, httpStatus: verdict.httpStatus, detail: verdict.detail };
  }

  // checkCommit already proved both rows exist; this narrows the types and
  // fails loudly rather than silently if that ever stops being true.
  if (!proposal || !plan) {
    throw new Error('checkCommit passed with a missing proposal or plan');
  }

  const board = await getCurrentBoard(db);
  const liveSlots: PlannedSlot[] = board.jobs
    .filter((row) => row.assignment)
    .map((row) => ({
      jobId: row.job.id,
      technicianId: row.assignment!.technicianId,
      windowStart: row.assignment!.windowStart,
      windowEnd: row.assignment!.windowEnd,
      travelBeforeMinutes: row.assignment!.travelBeforeMinutes,
    }));

  const slots = resultingSlots(liveSlots, plan.assignments);

  // The snapshot is written first because assignment rows reference its id.
  // It carries the full resulting slot set, so G4's rollback has something to
  // restore from rather than having to replay the plan.
  const snapshot = await db.boardSnapshots.createSnapshot(
    {
      date: board.date,
      committedPlanId: plan.id,
      profile: plan.profile,
      metrics: plan.metrics,
      assignments: slots,
    },
    { sourceSnapshotId: proposal.sourceSnapshotId, triggerEventId: proposal.eventId },
  );

  // Supersede before writing, or a moved job shows against both technicians.
  const applied: PlannedSlot[] = [];
  for (const slot of plan.assignments) {
    const existing = await db.assignments.getByJobId(slot.jobId);
    for (const row of existing) {
      if (row.status === 'accepted' || row.status === 'offered') {
        await db.assignments.supersede(row.id, 'reassigned');
      }
    }
    await db.assignments.createCommitted({
      jobId: slot.jobId,
      technicianId: slot.technicianId,
      snapshotId: snapshot.id,
      windowStart: slot.windowStart,
      windowEnd: slot.windowEnd,
      travelBeforeMinutes: slot.travelBeforeMinutes,
      metrics: plan.metrics,
    });
    applied.push(slot);
  }

  const committed = await db.proposals.updateStatus(proposal.id, 'COMMITTED', plan.id);
  await db.events.updateStatus(proposal.eventId, 'COMMITTED');

  await db.decisionLogs.create({
    eventId: proposal.eventId,
    eventType: 'commit',
    playbook: 'commit',
    stage: 'commit',
    toolCalls: [],
    summary: `Committed plan ${plan.id} (${plan.profile}) as snapshot v${snapshot.version}. ${applied.length} assignment(s) written by ${input.actorId}.`,
    reasonCodes: [verdict.mode],
    result: 'committed',
    approvalId: approval?.id,
  });

  return { ok: true, snapshot, proposal: committed, appliedSlots: applied };
}

export type { CandidatePlan };
