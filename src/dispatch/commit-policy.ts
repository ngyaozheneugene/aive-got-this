// Fail-closed commit guard. Decides whether a candidate plan may become the board.
//
// Pure on purpose: no HTTP, no database client, no clock, no randomness. Every
// refusal is reproducible from its inputs alone, so the negative tests run in
// milliseconds and the route handler stays a thin wrapper. Nothing here reads a
// request field to decide whether a commit is allowed — authorisation comes from
// the stored approval row.

import { RISK_POLICY, type CommitRejection } from '../shared/config/reason-codes';
import type {
  Approval,
  AutonomyMode,
  CandidatePlan,
  Proposal,
} from '../shared/types/domain';

export interface CommitCheckInput {
  /** The proposal named in the URL. `null` when no such row exists. */
  proposal: Proposal | null;
  /** The plan named in the request body. `null` when no such row exists. */
  plan: CandidatePlan | null;
  /** The approval row for this proposal, if one has been created. */
  approval: Approval | null;
  /** Id of the newest committed snapshot right now. */
  latestSnapshotId: string;
  /** Snapshot id the caller believes it planned against. */
  requestedSourceSnapshotId: string;
}

export type CommitCheck =
  | { ok: true; mode: AutonomyMode }
  | { ok: false; code: CommitRejection; httpStatus: number; detail: string };

const STRICTNESS: Record<AutonomyMode, number> = { auto: 0, approval: 1, block: 2 };

/** The more restrictive of two modes. Ties return the first. */
export function strictestMode(a: AutonomyMode, b: AutonomyMode): AutonomyMode {
  return STRICTNESS[a] >= STRICTNESS[b] ? a : b;
}

function reject(code: CommitRejection, httpStatus: number, detail: string): CommitCheck {
  return { ok: false, code, httpStatus, detail };
}

/**
 * Returns `{ ok: true }` only when every guard passes. Checks run cheapest and
 * most specific first, so the caller always gets the most informative reason:
 * an already-committed proposal is also stale, and "already committed" is the
 * more useful answer.
 */
export function checkCommit(input: CommitCheckInput): CommitCheck {
  const { proposal, plan, approval, latestSnapshotId, requestedSourceSnapshotId } = input;

  // 1-3. The rows must exist and belong together.
  if (!proposal) {
    return reject('proposal_not_found', 404, 'No proposal with that id.');
  }
  if (!plan) {
    return reject('plan_not_found', 404, 'No candidate plan with that id.');
  }
  if (plan.proposalId !== proposal.id) {
    return reject(
      'plan_not_in_proposal',
      400,
      `Plan ${plan.id} belongs to proposal ${plan.proposalId}, not ${proposal.id}.`,
    );
  }

  // 4. Terminal proposals never commit. Committing twice would create a second
  //    snapshot from the same decision.
  if (proposal.status === 'COMMITTED') {
    return reject('already_committed', 409, `Proposal ${proposal.id} is already committed.`);
  }
  if (
    proposal.status === 'SUPERSEDED' ||
    proposal.status === 'EXPIRED' ||
    proposal.status === 'REJECTED'
  ) {
    return reject('stale_snapshot', 409, `Proposal ${proposal.id} is ${proposal.status}.`);
  }

  // 5. The independent validator has the final say on hard constraints. The
  //    guard never re-derives feasibility; it only refuses to ignore the verdict.
  if (!plan.validations.ok) {
    const violations = plan.validations.violations.join(', ') || 'no detail recorded';
    return reject('validation_failed', 409, `Validator rejected this plan: ${violations}.`);
  }
  if (plan.status === 'REJECTED') {
    return reject('validation_failed', 409, `Plan ${plan.id} is marked REJECTED.`);
  }

  // 6. Snapshot protection (UC-07). Two distinct failures:
  //    - the caller names a baseline this proposal was not planned against
  //    - the board has moved on since this proposal was planned
  if (requestedSourceSnapshotId !== proposal.sourceSnapshotId) {
    return reject(
      'snapshot_mismatch',
      400,
      `Request names snapshot ${requestedSourceSnapshotId}; this proposal was planned against ${proposal.sourceSnapshotId}.`,
    );
  }
  if (proposal.sourceSnapshotId !== latestSnapshotId) {
    return reject(
      'stale_snapshot',
      409,
      `Board has moved to ${latestSnapshotId} since this proposal was planned against ${proposal.sourceSnapshotId}.`,
    );
  }

  // 7. Policy (UC-12). RISK_POLICY is the code-owned table. The proposal also
  //    carries the mode the classifier recorded; take whichever is stricter so a
  //    disagreement can only ever make the commit harder, never easier.
  const fromRisk = RISK_POLICY[proposal.risk] as AutonomyMode | undefined;
  const mode = strictestMode(fromRisk ?? 'block', proposal.autonomyMode ?? 'block');

  if (mode === 'block') {
    return reject('commit_blocked', 403, `Risk ${proposal.risk} has no commit path.`);
  }

  if (mode === 'approval') {
    if (!approval) {
      return reject('approval_required', 403, 'No approval row exists for this proposal.');
    }
    if (approval.proposalId !== proposal.id) {
      return reject('approval_required', 403, 'Approval belongs to a different proposal.');
    }
    if (approval.status !== 'approved') {
      return reject('approval_required', 403, `Approval is ${approval.status}, not approved.`);
    }
    if (approval.approvedPlanId !== plan.id) {
      return reject(
        'approval_required',
        403,
        `Approval covers plan ${approval.approvedPlanId ?? 'none'}, not ${plan.id}.`,
      );
    }
  }

  return { ok: true, mode };
}
