'use client';

import { useState } from 'react';
import { DeskApiError, deskApi, type PlanResult } from './desk-api';
import { CompareView } from './CompareView';
import { ApproveBar, type DecisionPhase } from './ApproveBar';
import { badge, card, label } from './ui';

/**
 * Owns the decision loop for one proposal: pick a plan, approve/reject with a
 * reason, then commit. Server refusals (stale snapshot, missing approval,
 * infeasible) are surfaced, not swallowed.
 */
export function ProposalPanel({
  result,
  onCommitted,
}: {
  result: PlanResult;
  onCommitted: (snapshotVersion: number) => void;
}) {
  const { proposal, plans } = result;
  const [selectedPlanId, setSelectedPlanId] = useState<string | undefined>(
    proposal.recommendedPlanId ?? plans.find((p) => p.validations.ok)?.id,
  );
  const [phase, setPhase] = useState<DecisionPhase>('recommended');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof DeskApiError
          ? `${e.code}${e.detail ? ` — ${e.detail}` : ''}`
          : 'Request failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  const approve = () =>
    run(async () => {
      if (!selectedPlanId) return;
      await deskApi.decide(proposal.id, 'approved', selectedPlanId, reason.trim());
      setPhase('approved');
      setNote('Approval recorded.');
    });

  const reject = () =>
    run(async () => {
      const planId = selectedPlanId ?? plans[0]?.id ?? '';
      await deskApi.decide(proposal.id, 'rejected', planId, reason.trim());
      setPhase('rejected');
      setNote('Proposal rejected. The board is unchanged.');
    });

  const commit = () =>
    run(async () => {
      if (!selectedPlanId) return;
      const res = await deskApi.commit(proposal.id, selectedPlanId, proposal.sourceSnapshotId);
      setPhase('committed');
      setNote(`Committed. New board is v${res.snapshot.version}.`);
      onCommitted(res.snapshot.version);
    });

  return (
    <section style={{ ...card, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
        <div>
          <span style={label}>Proposal</span>
          <p style={{ margin: '4px 0 0', fontSize: 16 }}>
            Recovery for the urgent job · engine {result.engine}
            {result.timedOut ? ' (insertion fallback)' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={badge(proposal.risk === 'high' ? 'bad' : proposal.risk === 'medium' ? 'warn' : 'good')}>
            {proposal.risk} risk
          </span>
          <span style={badge('muted')}>{proposal.autonomyMode}</span>
        </div>
      </div>

      {!result.comparisonReady ? (
        <p style={{ margin: 0, color: '#8a5a00', fontSize: 13 }}>
          {result.comparisonReasons?.includes('identical_plans')
            ? 'Both profiles assigned the same slots. This is not a choice.'
            : 'Only one profile produced a valid plan; showing what is available.'}
        </p>
      ) : null}

      <CompareView
        plans={plans}
        recommendedPlanId={proposal.recommendedPlanId}
        selectedPlanId={selectedPlanId}
        onSelect={phase === 'recommended' ? setSelectedPlanId : () => undefined}
      />

      <ApproveBar
        phase={phase}
        reason={reason}
        onReasonChange={setReason}
        planSelected={Boolean(selectedPlanId)}
        busy={busy}
        onApprove={approve}
        onReject={reject}
        onCommit={commit}
      />

      {note ? <p style={{ margin: 0, color: '#1f6b3b', fontSize: 13 }}>{note}</p> : null}
      {error ? (
        <p style={{ margin: 0, color: '#8c2f21', fontSize: 13 }}>
          <strong>Refused:</strong> {error}
        </p>
      ) : null}
    </section>
  );
}
