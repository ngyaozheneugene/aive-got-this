// The commit guard is the safety argument, so the refusals are the deliverable.
// UC-07 stale snapshot, UC-12 approval required, UC-02/UC-06 blocked high risk.

import { describe, expect, it } from 'vitest';
import { checkCommit, strictestMode, type CommitCheckInput } from './commit-policy';
import type {
  Approval,
  CandidatePlan,
  PlanMetrics,
  Proposal,
  RiskLevel,
} from '../shared/types/domain';

const SNAP_CURRENT = 'snap_eastwind_v1';
const SNAP_NEWER = 'snap_eastwind_v2';

const metrics: PlanMetrics = {
  slaLatenessMinutes: 0,
  travelMinutes: 30,
  overtimeMinutes: 0,
  jobsMoved: 1,
  customersAffected: 1,
  unassignedCount: 0,
};

function makeProposal(over: Partial<Proposal> = {}): Proposal {
  return {
    id: 'prop_1',
    eventId: 'opev_1',
    sourceSnapshotId: SNAP_CURRENT,
    risk: 'low',
    autonomyMode: 'auto',
    status: 'RECOMMENDED',
    createdAt: '2026-09-15T09:00:00+08:00',
    ...over,
  };
}

function makePlan(over: Partial<CandidatePlan> = {}): CandidatePlan {
  return {
    id: 'plan_1',
    proposalId: 'prop_1',
    sourceSnapshotId: SNAP_CURRENT,
    profile: 'sla_first',
    assignments: [{ jobId: 'job_raffles', technicianId: 'tech_wei' }],
    changeSet: [],
    metrics,
    validations: { ok: true, violations: [] },
    solverTrace: {},
    timedOut: false,
    status: 'VALIDATED',
    createdAt: '2026-09-15T09:00:00+08:00',
    ...over,
  };
}

function makeApproval(over: Partial<Approval> = {}): Approval {
  return {
    id: 'appr_1',
    proposalId: 'prop_1',
    threadId: 'thread_1',
    triggerReason: 'reassignment moves a promised window',
    recommendation: {},
    approvedPlanId: 'plan_1',
    status: 'approved',
    actionedBy: 'user_desk',
    createdAt: '2026-09-15T09:05:00+08:00',
    ...over,
  };
}

function input(over: Partial<CommitCheckInput> = {}): CommitCheckInput {
  return {
    proposal: makeProposal(),
    plan: makePlan(),
    approval: null,
    latestSnapshotId: SNAP_CURRENT,
    requestedSourceSnapshotId: SNAP_CURRENT,
    ...over,
  };
}

describe('checkCommit — allows', () => {
  it('a low-risk validated plan against the current snapshot', () => {
    const result = checkCommit(input());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mode).toBe('auto');
  });

  it('a medium-risk plan when an approval row covers that exact plan', () => {
    const result = checkCommit(
      input({
        proposal: makeProposal({ risk: 'medium', autonomyMode: 'approval' }),
        approval: makeApproval(),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mode).toBe('approval');
  });
});

describe('checkCommit — missing or mismatched rows', () => {
  it('refuses when the proposal does not exist', () => {
    const result = checkCommit(input({ proposal: null }));
    expect(result).toMatchObject({ ok: false, code: 'proposal_not_found', httpStatus: 404 });
  });

  it('refuses when the plan does not exist', () => {
    const result = checkCommit(input({ plan: null }));
    expect(result).toMatchObject({ ok: false, code: 'plan_not_found', httpStatus: 404 });
  });

  it('refuses a plan belonging to a different proposal', () => {
    const result = checkCommit(input({ plan: makePlan({ proposalId: 'prop_other' }) }));
    expect(result).toMatchObject({ ok: false, code: 'plan_not_in_proposal', httpStatus: 400 });
  });
});

describe('checkCommit — validation', () => {
  it('refuses a plan the validator rejected, and names the violations', () => {
    const result = checkCommit(
      input({
        plan: makePlan({
          validations: { ok: false, violations: ['OVERLAP', 'MISSING_CERT'] },
        }),
      }),
    );
    expect(result).toMatchObject({ ok: false, code: 'validation_failed', httpStatus: 409 });
    if (!result.ok) expect(result.detail).toContain('OVERLAP');
  });

  it('refuses a plan marked REJECTED even when validations look ok', () => {
    const result = checkCommit(input({ plan: makePlan({ status: 'REJECTED' }) }));
    expect(result).toMatchObject({ ok: false, code: 'validation_failed' });
  });
});

describe('checkCommit — snapshot protection (UC-07)', () => {
  it('refuses when the board moved on after the proposal was planned', () => {
    const result = checkCommit(input({ latestSnapshotId: SNAP_NEWER }));
    expect(result).toMatchObject({ ok: false, code: 'stale_snapshot', httpStatus: 409 });
    if (!result.ok) expect(result.detail).toContain(SNAP_NEWER);
  });

  it('refuses when the caller names a baseline the proposal was not planned against', () => {
    const result = checkCommit(input({ requestedSourceSnapshotId: SNAP_NEWER }));
    expect(result).toMatchObject({ ok: false, code: 'snapshot_mismatch', httpStatus: 400 });
  });

  it('reports already_committed rather than stale for a committed proposal', () => {
    const result = checkCommit(
      input({
        proposal: makeProposal({ status: 'COMMITTED' }),
        latestSnapshotId: SNAP_NEWER,
      }),
    );
    expect(result).toMatchObject({ ok: false, code: 'already_committed', httpStatus: 409 });
  });
});

describe('checkCommit — policy (UC-02, UC-06, UC-12)', () => {
  it('blocks high risk outright, approval row or not', () => {
    const blocked = checkCommit(
      input({ proposal: makeProposal({ risk: 'high', autonomyMode: 'block' }) }),
    );
    expect(blocked).toMatchObject({ ok: false, code: 'commit_blocked', httpStatus: 403 });

    const stillBlocked = checkCommit(
      input({
        proposal: makeProposal({ risk: 'high', autonomyMode: 'block' }),
        approval: makeApproval(),
      }),
    );
    expect(stillBlocked).toMatchObject({ ok: false, code: 'commit_blocked' });
  });

  it('refuses medium risk with no approval row at all', () => {
    const result = checkCommit(
      input({ proposal: makeProposal({ risk: 'medium', autonomyMode: 'approval' }) }),
    );
    expect(result).toMatchObject({ ok: false, code: 'approval_required', httpStatus: 403 });
  });

  it('refuses medium risk while the approval is still pending', () => {
    const result = checkCommit(
      input({
        proposal: makeProposal({ risk: 'medium', autonomyMode: 'approval' }),
        approval: makeApproval({ status: 'pending' }),
      }),
    );
    expect(result).toMatchObject({ ok: false, code: 'approval_required' });
  });

  it('refuses medium risk when the approval was rejected', () => {
    const result = checkCommit(
      input({
        proposal: makeProposal({ risk: 'medium', autonomyMode: 'approval' }),
        approval: makeApproval({ status: 'rejected' }),
      }),
    );
    expect(result).toMatchObject({ ok: false, code: 'approval_required' });
  });

  it('refuses when the approval covers a different plan than the one being committed', () => {
    const result = checkCommit(
      input({
        proposal: makeProposal({ risk: 'medium', autonomyMode: 'approval' }),
        approval: makeApproval({ approvedPlanId: 'plan_other' }),
      }),
    );
    expect(result).toMatchObject({ ok: false, code: 'approval_required' });
    if (!result.ok) expect(result.detail).toContain('plan_other');
  });

  it('takes the stricter of RISK_POLICY and the recorded autonomy mode', () => {
    // Risk says auto, the classifier recorded approval: approval must win.
    const needsApproval = checkCommit(
      input({ proposal: makeProposal({ risk: 'low', autonomyMode: 'approval' }) }),
    );
    expect(needsApproval).toMatchObject({ ok: false, code: 'approval_required' });

    // Risk says block, the stored mode says auto: block must win.
    const blocked = checkCommit(
      input({ proposal: makeProposal({ risk: 'high', autonomyMode: 'auto' }) }),
    );
    expect(blocked).toMatchObject({ ok: false, code: 'commit_blocked' });
  });

  it('never lets a request field authorise a commit', () => {
    // A caller that sends every "approved" flag it can imagine still gets 403,
    // because authorisation is read from the approval row only.
    const hostile = {
      ...input({ proposal: makeProposal({ risk: 'medium', autonomyMode: 'approval' }) }),
      approved: true,
      force: true,
      skipApproval: true,
    } as CommitCheckInput;
    expect(checkCommit(hostile)).toMatchObject({ ok: false, code: 'approval_required' });
  });

  it('falls back to block when risk carries an unexpected value', () => {
    const result = checkCommit(
      input({ proposal: makeProposal({ risk: 'catastrophic' as RiskLevel }) }),
    );
    expect(result).toMatchObject({ ok: false, code: 'commit_blocked' });
  });
});

describe('strictestMode', () => {
  it('orders auto < approval < block', () => {
    expect(strictestMode('auto', 'approval')).toBe('approval');
    expect(strictestMode('approval', 'block')).toBe('block');
    expect(strictestMode('block', 'auto')).toBe('block');
    expect(strictestMode('auto', 'auto')).toBe('auto');
  });
});
