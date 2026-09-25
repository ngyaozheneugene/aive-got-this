'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, BellRing, ChevronRight, XCircle } from 'lucide-react';
import type { CandidatePlan, DeskBoard } from '../../shared/types/domain';
import { DeskApiError, deskApi, type PlanResult } from './desk-api';
import { CompareView } from './CompareView';
import { ApproveBar, type DecisionPhase } from './ApproveBar';
import { approveReasons, describeChanges, profileName, recommendationReason, refusalCopy, riskCopy } from './copy';
import { DrawnCheck, LiveDot } from './fx';
import { Badge } from './ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

interface DeskError {
  title: string;
  detail: string;
  code: string;
}

/**
 * Owns the decision for one problem: pick an option, give a reason, approve.
 * Approving records the approval and then applies it; the server checks the
 * approval, the plan and that the schedule has not changed underneath.
 * Refusals are surfaced in plain words with the code kept for the record.
 */
export function ProposalPanel({
  result,
  board,
  source,
  title,
  detail,
  onCommitted,
  onRejected,
  onPreview,
}: {
  result: PlanResult;
  board: DeskBoard;
  /** Where the event came from, e.g. "Customer call". */
  source?: string;
  title: string;
  detail?: string;
  onCommitted: (snapshotVersion: number) => void;
  onRejected?: () => void;
  /** The plan the desk should draw over the board, or none once decided away. */
  onPreview?: (plan: CandidatePlan | undefined) => void;
}) {
  const { proposal, plans } = result;
  const [selectedPlanId, setSelectedPlanId] = useState<string | undefined>(
    proposal.recommendedPlanId ?? plans.find((p) => p.validations.ok)?.id,
  );
  const [phase, setPhase] = useState<DecisionPhase>('recommended');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DeskError | null>(null);
  // The board this proposal was made against; the live board moves on commit.
  const [sourceBoard] = useState(board);
  const [applied, setApplied] = useState<{ changes: string[]; version: number; plan: CandidatePlan } | null>(null);

  const selected = plans.find((p) => p.id === selectedPlanId);
  const risk = riskCopy(proposal.risk);

  useEffect(() => {
    const live = phase === 'recommended' || phase === 'approved';
    onPreview?.(live ? selected : undefined);
  }, [phase, selected, onPreview]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const code = e instanceof DeskApiError ? e.code : 'request_failed';
      setError({ ...refusalCopy(code), code: e instanceof DeskApiError && e.detail ? `${code} — ${e.detail}` : code });
    } finally {
      setBusy(false);
    }
  }

  const apply = async (plan: CandidatePlan) => {
    const res = await deskApi.commit(proposal.id, plan.id, proposal.sourceSnapshotId);
    setApplied({ changes: describeChanges(sourceBoard, plan), version: res.snapshot.version, plan });
    setPhase('committed');
    onCommitted(res.snapshot.version);
  };

  const approve = () =>
    run(async () => {
      if (!selected) return;
      await deskApi.decide(proposal.id, 'approved', selected.id, reason.trim());
      setPhase('approved');
      await apply(selected);
    });

  const retryApply = () =>
    run(async () => {
      if (selected) await apply(selected);
    });

  const reject = () =>
    run(async () => {
      const planId = selectedPlanId ?? plans[0]?.id ?? '';
      await deskApi.decide(proposal.id, 'rejected', planId, reason.trim());
      setPhase('rejected');
      onRejected?.();
    });

  return (
    <Card>
      <CardHeader>
        {source ? (
          <CardDescription className="flex items-center gap-2 text-warning">
            {phase === 'recommended' || phase === 'approved' ? <LiveDot tone="warning" /> : <BellRing className="size-4" />}
            {phase === 'recommended' || phase === 'approved' ? 'New · ' : ''}
            {source}
          </CardDescription>
        ) : null}
        <CardTitle>{title}</CardTitle>
        {detail ? <CardDescription>{detail}</CardDescription> : null}
        <CardAction>
          {phase === 'committed' ? (
            <Badge variant="success">Done</Badge>
          ) : phase === 'rejected' ? (
            <Badge variant="secondary">Rejected</Badge>
          ) : (
            <Badge variant={risk.tone} title={risk.detail}>
              {risk.label}
            </Badge>
          )}
        </CardAction>
      </CardHeader>

      <CardContent className="grid gap-4">
        {phase === 'committed' && applied ? (
          <div className="grid gap-2 rounded-lg border border-success/30 bg-success/5 p-4">
            <p className="flex items-center gap-2 font-medium text-success">
              <DrawnCheck className="shrink-0" />
              Schedule updated with “{profileName(applied.plan.profile)}”
            </p>
            <ul className="grid gap-1 pl-7 text-sm">
              {applied.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p className="pl-7 text-xs text-muted-foreground">
              Your reason: “{reason.trim()}” · Saved as schedule version {applied.version}.
              {applied.plan.metrics.customersAffected > 0
                ? ` Let ${applied.plan.metrics.customersAffected === 1 ? 'the customer' : `${applied.plan.metrics.customersAffected} customers`} know.`
                : ''}
            </p>
          </div>
        ) : null}

        {phase === 'rejected' ? (
          <p className="flex items-center gap-2 rounded-lg border bg-muted/40 p-4 text-sm">
            <XCircle className="size-4 shrink-0 text-muted-foreground" />
            Both options rejected. The schedule is unchanged — arrange this one manually.
          </p>
        ) : null}

        {phase === 'recommended' || phase === 'approved' ? (
          <>
            <p className="text-sm text-muted-foreground">{risk.detail} Nothing changes until you approve.</p>

            {!result.comparisonReady ? (
              <p className="flex items-center gap-2 text-sm text-warning">
                <AlertTriangle className="size-4 shrink-0" />
                {result.comparisonReasons?.includes('identical_plans')
                  ? 'Both priorities came up with the same answer, so there is only one real option.'
                  : 'Only one option passed every check.'}
              </p>
            ) : null}

            <CompareView
              plans={plans}
              board={sourceBoard}
              recommendedPlanId={proposal.recommendedPlanId}
              recommendation={recommendationReason(
                result.selectionBasis,
                plans.find((p) => p.id === proposal.recommendedPlanId),
              )}
              selectedPlanId={selectedPlanId}
              onSelect={phase === 'recommended' ? setSelectedPlanId : () => undefined}
            />
          </>
        ) : null}

        <ApproveBar
          phase={phase}
          reason={reason}
          onReasonChange={setReason}
          suggestions={approveReasons(sourceBoard, selected, plans)}
          planName={selected ? profileName(selected.profile) : undefined}
          busy={busy}
          onApprove={approve}
          onReject={reject}
          onRetryApply={retryApply}
        />

        {error ? (
          <div className="grid gap-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-destructive">
              <XCircle className="size-4 shrink-0" />
              {error.title}
            </p>
            <p className="pl-6 text-muted-foreground">{error.detail}</p>
            <TechnicalDetails>
              <span className="font-mono">{error.code}</span>
            </TechnicalDetails>
          </div>
        ) : null}

        <TechnicalDetails>
          Planned by the <span className="font-mono">{result.engine}</span> engine
          {result.timedOut ? ' (quick fallback after a timeout)' : ''} · {result.agent.modelCalls} assistant steps ·
          approval mode <span className="font-mono">{proposal.autonomyMode}</span> · risk{' '}
          <span className="font-mono">{proposal.risk}</span>
        </TechnicalDetails>
      </CardContent>
    </Card>
  );
}

function TechnicalDetails({ children }: { children: React.ReactNode }) {
  return (
    <details className="group text-xs text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-1 hover:text-foreground">
        <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
        Technical details
      </summary>
      <p className="mt-1 pl-4">{children}</p>
    </details>
  );
}
