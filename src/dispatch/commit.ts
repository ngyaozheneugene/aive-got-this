// The write path. The single place in the codebase that calls
// boardSnapshots.createSnapshot, and it only gets there once checkCommit agrees.
//
// Split deliberately: commit-policy.ts decides (pure, no I/O), this file acts
// (I/O, no decisions). Neither re-derives what the other owns.

import { checkCommit } from './commit-policy';
import { parseUnavailability, unavailabilityPatch } from '../matching/disruption';
import { unassignedOf } from '../matching/unassigned';
import { nextSequence } from './audit-sequence';
import { getCurrentBoard } from './current-board';
import { isStaleSnapshotError, type IDatabase } from '../db/interface';
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

/**
 * Every write a commit makes lands together: on Postgres in one transaction,
 * so a failure part-way leaves the board as it was rather than half-moved.
 * A commit that loses a race to another one, after both passed checkCommit,
 * is refused as stale by the snapshot write itself.
 */
export async function commitPlan(db: IDatabase, input: CommitInput): Promise<CommitResult> {
  try {
    return await db.transaction((tx) => commitWithin(tx, input));
  } catch (e) {
    if (isStaleSnapshotError(e)) {
      return {
        ok: false,
        code: 'stale_snapshot',
        httpStatus: 409,
        detail: `Another change was committed first; plan ${input.planId} was made against an older board.`,
      };
    }
    throw e;
  }
}

async function commitWithin(db: IDatabase, input: CommitInput): Promise<CommitResult> {
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

  // Partial coverage: jobs the plan leaves for a call come off the board.
  const unassigned = unassignedOf(plan);
  const leaving = new Set(unassigned.map((u) => u.jobId));
  const slots = resultingSlots(liveSlots, plan.assignments).filter((s) => !leaving.has(s.jobId));

  // The snapshot is written first because assignment rows reference its id.
  // It carries the full resulting slot set, so G4's rollback has something to
  // restore from rather than having to replay the plan.
  const snapshot = await db.boardSnapshots.createSnapshot(
    {
      date: board.date,
      ...((latest?.snapshotData as { followsClock?: unknown } | undefined)?.followsClock === true ? { followsClock: true } : {}),
      committedPlanId: plan.id,
      profile: plan.profile,
      metrics: plan.metrics,
      assignments: slots,
    },
    { sourceSnapshotId: proposal.sourceSnapshotId, triggerEventId: proposal.eventId },
  );

  // Write only what actually changes.
  //
  // propose() returns the whole day - the new slot plus every assignment that
  // was already live. Writing all of them would churn a dozen rows for a
  // one-job insertion and leave an audit trail claiming twelve jobs moved when
  // one did. Slots that match the live row exactly are skipped, so `applied`
  // and the decision log describe the real change whatever the engine hands us.
  const applied: PlannedSlot[] = [];
  for (const slot of plan.assignments) {
    const live = (await db.assignments.getByJobId(slot.jobId)).filter(
      (row) => row.status === 'accepted' || row.status === 'offered',
    );

    const unchanged =
      live.length === 1 &&
      live[0]!.technicianId === slot.technicianId &&
      live[0]!.windowStart === slot.windowStart &&
      live[0]!.windowEnd === slot.windowEnd;
    if (unchanged) continue;

    // Supersede before writing, or a moved job shows against both technicians.
    for (const row of live) {
      await db.assignments.supersede(row.id, 'reassigned');
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

  // Their booking is cancelled, not reassigned, and the job waits again: it
  // shows under "Needs a technician" until someone calls the customer.
  for (const left of unassigned) {
    for (const row of await db.assignments.getByJobId(left.jobId)) {
      if (row.status === 'accepted' || row.status === 'offered') await db.assignments.supersede(row.id, 'cancelled');
    }
    await db.jobs.updateStatus(left.jobId, 'unassigned', input.actorId, 'desk', `partial_coverage:${left.reason}`);
  }

  // An unavailability changes the technician's shift as well as their jobs, so
  // the next event plans around the cut day instead of handing work back.
  const event = await db.events.getById(proposal.eventId);
  const unavailability = event ? parseUnavailability(event) : null;
  if (unavailability) {
    const shift = await db.shifts.getByTechAndDate(unavailability.technicianId, board.date);
    await db.shifts.patch(unavailability.technicianId, board.date, unavailabilityPatch(shift ?? undefined, unavailability));
  }

  // An overrun means the job is under way; record it, so later plans let it run past its window.
  const overrunJobId = event?.type === 'job_overrun' ? (event.normalizedPayload?.jobId as string | undefined) : undefined;
  if (overrunJobId) {
    const job = await db.jobs.getById(overrunJobId);
    if (job && job.status !== 'on_site') await db.jobs.updateStatus(overrunJobId, 'on_site', input.actorId, 'desk', 'job_overrun');
  }

  const committed = await db.proposals.updateStatus(proposal.id, 'COMMITTED', plan.id);
  await db.events.updateStatus(proposal.eventId, 'COMMITTED');

  await db.decisionLogs.create({
    eventId: proposal.eventId,
    eventType: 'commit',
    sequence: await nextSequence(db, proposal.eventId),
    playbook: 'commit',
    stage: 'commit',
    toolCalls: [],
    summary: `Committed plan ${plan.id} (${plan.profile}) as snapshot v${snapshot.version}. ${applied.length} assignment(s) written${unassigned.length ? `, ${unassigned.length} job(s) left for a call` : ''} by ${input.actorId}.`,
    reasonCodes: [verdict.mode],
    result: 'committed',
    approvalId: approval?.id,
  });

  return { ok: true, snapshot, proposal: committed, appliedSlots: applied };
}

export type { CandidatePlan };
