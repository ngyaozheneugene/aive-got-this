// Recording a desk decision. This is the only way an `approval` row is created
// or actioned, and it is what the commit guard later reads.
//
// One row per decision. A later decision supersedes an earlier one rather than
// mutating it, so the table stays a record of what the desk actually did and
// `getByProposal` returning the newest row is the live verdict.

import type { IDatabase } from '../db/interface';
import type { Approval, Proposal } from '../shared/types/domain';

export interface DecisionInput {
  proposalId: string;
  decision: 'approved' | 'rejected';
  /** Which plan is being approved. Falls back to the proposal's recommendation. */
  planId?: string;
  reason: string;
  actorId: string;
}

export type DecisionResult =
  | { ok: true; approval: Approval; proposal: Proposal }
  | { ok: false; code: string; httpStatus: number; detail: string };

function fail(code: string, httpStatus: number, detail: string): DecisionResult {
  return { ok: false, code, httpStatus, detail };
}

export async function recordDecision(
  db: IDatabase,
  input: DecisionInput,
): Promise<DecisionResult> {
  const proposal = await db.proposals.getById(input.proposalId);
  if (!proposal) {
    return fail('proposal_not_found', 404, 'No proposal with that id.');
  }
  if (proposal.status === 'COMMITTED') {
    return fail('already_committed', 409, 'This proposal is already committed.');
  }

  // Approving "the recommendation" is the common desk action, so an omitted
  // planId means the recommended plan. Rejecting needs no plan at all.
  const planId = input.planId ?? proposal.recommendedPlanId;

  if (input.decision === 'approved') {
    if (!planId) {
      return fail(
        'plan_required',
        400,
        'Approving needs a planId, and this proposal has no recommendation to fall back on.',
      );
    }
    const plan = await db.candidatePlans.getById(planId);
    if (!plan) {
      return fail('plan_not_found', 404, `No candidate plan ${planId}.`);
    }
    if (plan.proposalId !== proposal.id) {
      return fail(
        'plan_not_in_proposal',
        400,
        `Plan ${planId} belongs to proposal ${plan.proposalId}, not ${proposal.id}.`,
      );
    }
  }

  // Created pending, then actioned, so every row carries the same shape whether
  // it was decided by the desk now or left waiting.
  const pending = await db.approvals.create({
    proposalId: proposal.id,
    threadId: `thread_${proposal.eventId}`,
    sourceSnapshotId: proposal.sourceSnapshotId,
    triggerReason: `${proposal.risk} risk, autonomy ${proposal.autonomyMode}`,
    recommendation: { recommendedPlanId: proposal.recommendedPlanId ?? null },
    policyReasons: [proposal.autonomyMode],
    approvedPlanId: input.decision === 'approved' ? planId : undefined,
    status: 'pending',
  });

  const approval = await db.approvals.action(
    pending.id,
    input.decision,
    input.actorId,
    input.reason,
  );

  const updated = await db.proposals.updateStatus(
    proposal.id,
    input.decision === 'approved' ? 'APPROVED' : 'REJECTED',
    input.decision === 'approved' ? planId : undefined,
  );

  // A rejection closes the event. An approval leaves it awaiting commit.
  if (input.decision === 'rejected') {
    await db.events.updateStatus(proposal.eventId, 'REJECTED');
  }

  await db.decisionLogs.create({
    eventId: proposal.eventId,
    eventType: 'desk_decision',
    playbook: 'approval',
    stage: 'decision',
    toolCalls: [],
    summary: `Desk ${input.decision} ${planId ?? 'no plan'}: ${input.reason}`,
    reasonCodes: [input.decision],
    result: input.decision,
    approvalId: approval.id,
  });

  return { ok: true, approval, proposal: updated };
}
