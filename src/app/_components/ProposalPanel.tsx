'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, BellRing, ChevronRight, ShieldCheck, XCircle } from 'lucide-react';
import type { CandidatePlan, DeskBoard } from '../../shared/types/domain';
import { DeskApiError, deskApi, type PlanResult } from './desk-api';
import { CompareView } from './CompareView';
import { ApproveBar, type DecisionPhase } from './ApproveBar';
import { approveReasons, describeCancelled, describeChanges, profileName, recommendationReason, refusalCopy, riskCopy } from './copy';
import { DrawnCheck, LiveDot } from './fx';
import { Badge } from './ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

interface Applied {
  changes: string[];
  /** Unknown when the server reports the plan was applied before this panel saw it. */
  version?: number;
  plan: CandidatePlan;
}

/**
 * Everything the panel knows about one proposal's decision. The page keeps it,
 * because the event card unmounts when it is closed: without it, reopening a
 * decided proposal would offer the choice again.
 */
export interface ProposalMemory {
  proposalId: string;
  phase: DecisionPhase;
  selectedPlanId?: string;
  reason: string;
  applied: Applied | null;
  /** The board the options were made against; the live board moves on commit. */
  sourceBoard: DeskBoard;
}

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
  onAlreadyApplied,
  onPreview,
  memory,
  onMemoryChange,
}: {
  result: PlanResult;
  board: DeskBoard;
  /** Where the event came from, e.g. "Customer call". */
  source?: string;
  title: string;
  detail?: string;
  onCommitted: (snapshotVersion: number) => void;
  onRejected?: () => void;
  /** The server says this proposal was already applied (e.g. from another tab). */
  onAlreadyApplied?: () => void;
  /** The plan the desk should draw over the board, or none once decided away. */
  onPreview?: (plan: CandidatePlan | undefined) => void;
  /** Where to resume from when the panel is rebuilt; ignored if it is for another proposal. */
  memory?: ProposalMemory;
  onMemoryChange?: (memory: ProposalMemory) => void;
}) {
  const { proposal, plans } = result;
  const saved = memory?.proposalId === proposal.id ? memory : undefined;
  const [selectedPlanId, setSelectedPlanId] = useState<string | undefined>(
    saved ? saved.selectedPlanId : proposal.recommendedPlanId ?? plans.find((p) => p.validations.ok)?.id,
  );
  const [phase, setPhase] = useState<DecisionPhase>(saved?.phase ?? 'recommended');
  const [reason, setReason] = useState(saved?.reason ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DeskError | null>(null);
  // The board this proposal was made against; the live board moves on commit.
  const [sourceBoard] = useState(saved?.sourceBoard ?? board);
  const [applied, setApplied] = useState<Applied | null>(saved?.applied ?? null);

  useEffect(() => {
    onMemoryChange?.({ proposalId: proposal.id, phase, selectedPlanId, reason, applied, sourceBoard });
  }, [onMemoryChange, proposal.id, phase, selectedPlanId, reason, applied, sourceBoard]);

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
      if (code === 'already_committed') {
        // Already on the schedule: show it as done rather than offer the choice again.
        const plan = plans.find((p) => p.id === selectedPlanId);
        if (plan) setApplied((prev) => prev ?? { changes: [...describeCancelled(sourceBoard, plan), ...describeChanges(sourceBoard, plan)], plan });
        setPhase('committed');
        onAlreadyApplied?.();
        return;
      }
      setError({ ...refusalCopy(code), code: e instanceof DeskApiError && e.detail ? `${code} — ${e.detail}` : code });
    } finally {
      setBusy(false);
    }
  }

  const apply = async (plan: CandidatePlan) => {
    const res = await deskApi.commit(proposal.id, plan.id, proposal.sourceSnapshotId);
    setApplied({ changes: [...describeCancelled(sourceBoard, plan), ...describeChanges(sourceBoard, plan)], version: res.snapshot.version, plan });
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
      <CardHeader className="gap-1.5">
        {/* Status on its own line, so the title and details get the full width. */}
        <div className="flex min-h-7 items-center justify-between gap-3 pr-8">
          {source ? (
            <span className="flex items-center gap-2 text-xs font-semibold tracking-wide text-warning uppercase">
              {phase === 'recommended' || phase === 'approved' ? <LiveDot tone="warning" /> : <BellRing className="size-3.5" />}
              {phase === 'recommended' || phase === 'approved' ? 'New · ' : ''}
              {source}
            </span>
          ) : (
            <span />
          )}
          {phase === 'committed' ? (
            <Badge variant="success">Done</Badge>
          ) : phase === 'rejected' ? (
            <Badge variant="secondary">Rejected</Badge>
          ) : (
            <Badge variant={risk.tone} title={risk.detail}>
              {risk.label}
            </Badge>
          )}
        </div>
        <CardTitle className="text-[17px] leading-snug text-balance">{title}</CardTitle>
        {detail ? <CardDescription className="leading-relaxed">{detail}</CardDescription> : null}
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
              {reason.trim() ? `Your reason: “${reason.trim()}” · ` : ''}
              {applied.version !== undefined ? `Saved as schedule version ${applied.version}.` : 'Already on the schedule.'}
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
            <p className="flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-px size-3.5 shrink-0" />
              <span>
                {risk.detail} Nothing changes until you approve.
              </span>
            </p>

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
                plans.find((p) => p.id !== proposal.recommendedPlanId),
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
