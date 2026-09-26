'use client';

import { Fragment, useEffect, useState } from 'react';
import { ArrowDown, Bot, ChevronRight, Hourglass, ShieldCheck, UserRound, XCircle } from 'lucide-react';
import type { DecisionLog } from '../../shared/types/domain';
import { DeskApiError, deskApi } from './desk-api';
import { cn } from './lib/utils';
import { ACTOR_COPY, type Actor, type TraceStep, tracePhases } from './trace-steps';
import { Skeleton } from './ui/skeleton';

const ACTOR_STYLE: Record<Actor, { icon: typeof Bot; lane: string; chip: string; dot: string }> = {
  ai: { icon: Bot, lane: 'border-primary/30 bg-primary/5', chip: 'bg-primary/15 text-primary', dot: 'bg-primary' },
  system: { icon: ShieldCheck, lane: 'border-success/30 bg-success/5', chip: 'bg-success/15 text-success', dot: 'bg-success' },
  you: { icon: UserRound, lane: 'border-warning/35 bg-warning/5', chip: 'bg-warning/15 text-warning', dot: 'bg-warning' },
};

/**
 * One event's stored decision log drawn as a flow: what the AI chose, what
 * the system checked, what the person decided. Refetches when `refreshKey`
 * changes so a decision shows up as soon as it is saved.
 */
export function TraceGraph({
  eventId,
  refreshKey,
  awaitingDecision,
}: {
  eventId: string;
  refreshKey?: unknown;
  /** Draw the empty "you decide" step while the proposal is still open. */
  awaitingDecision?: boolean;
}) {
  const [entries, setEntries] = useState<DecisionLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    deskApi.audit(eventId).then(
      (audit) => {
        if (!cancelled) setEntries(audit.entries);
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof DeskApiError ? e.message : 'Could not load what happened.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, refreshKey]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!entries) {
    return (
      <div className="grid gap-2">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    );
  }
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">Nothing recorded for this event yet.</p>;

  const phases = tracePhases(entries);
  const decided = phases.some((p) => p.actor === 'you');

  return (
    <ol className="grid min-w-0 grid-cols-1 gap-1.5" aria-label="What happened, step by step">
      {phases.map((phase, i) => (
        <Fragment key={phase.steps[0]!.key}>
          {i > 0 ? <Connector /> : null}
          <Lane actor={phase.actor}>
            {phase.steps.map((step) => (
              <StepNode key={step.key} step={step} actor={phase.actor} />
            ))}
          </Lane>
        </Fragment>
      ))}
      {awaitingDecision && !decided ? (
        <>
          <Connector />
          <li className="flex items-center gap-2 rounded-lg border border-dashed border-warning/50 px-3 py-2 text-sm text-warning">
            <Hourglass className="size-4 shrink-0" />
            <span>
              <span className="font-medium">You decide</span>
              <span className="text-muted-foreground"> — nothing changes until you approve.</span>
            </span>
          </li>
        </>
      ) : null}
    </ol>
  );
}

function Lane({ actor, children }: { actor: Actor; children: React.ReactNode }) {
  const style = ACTOR_STYLE[actor];
  const Icon = style.icon;
  return (
    <li className={cn('grid min-w-0 grid-cols-1 gap-1 rounded-lg border p-2', style.lane)}>
      <div className="flex min-w-0 items-center gap-2 px-1" title={ACTOR_COPY[actor].blurb}>
        <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap', style.chip)}>
          <Icon className="size-3" />
          {ACTOR_COPY[actor].name}
        </span>
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">{ACTOR_COPY[actor].blurb}</span>
      </div>
      <ol className="relative grid min-w-0 grid-cols-1 gap-0.5 pl-3">
        <span aria-hidden className="absolute top-3 bottom-3 left-[17px] w-px bg-border" />
        {children}
      </ol>
    </li>
  );
}

function StepNode({ step, actor }: { step: TraceStep; actor: Actor }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-md px-1 py-1 text-left text-sm hover:bg-accent/50"
      >
        <span
          aria-hidden
          className={cn(
            'relative z-10 size-2.5 shrink-0 rounded-full ring-4 ring-card',
            step.failed ? 'bg-destructive' : ACTOR_STYLE[actor].dot,
          )}
        />
        <span className={cn('min-w-0 flex-1 truncate', step.failed && 'text-destructive')}>
          {step.label}
          {step.count > 1 ? <span className="text-muted-foreground"> ×{step.count}</span> : null}
        </span>
        {step.failed ? <XCircle className="size-3.5 shrink-0 text-destructive" /> : null}
        {step.durationMs > 0 ? (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{formatMs(step.durationMs)}</span>
        ) : null}
        <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
      </button>
      {open ? (
        <div className="grid gap-1.5 pb-2 pl-6 text-xs">
          <p className="text-muted-foreground">{step.detail}</p>
          {step.entries.some((e) => e.toolCalls.length > 0) ? (
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-muted-foreground hover:text-foreground">
                <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
                Technical details
              </summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded-md border bg-background p-2 font-mono text-[11px] whitespace-pre-wrap">
                {JSON.stringify(step.entries.flatMap((e) => e.toolCalls), null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Connector() {
  return (
    <li aria-hidden className="flex justify-center text-muted-foreground">
      <ArrowDown className="size-3.5" />
    </li>
  );
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}
