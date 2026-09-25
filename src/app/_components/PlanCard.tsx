import { ArrowDown, ArrowUp, ChevronRight, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react';
import type { CandidatePlan, DeskBoard } from '../../shared/types/domain';
import { METRIC_COPY, PROFILE_COPY, compareToOther, describeChanges, profileName, violationCopy, workloadNotes } from './copy';
import { cn } from './lib/utils';
import { Badge } from './ui/badge';

const METRIC_KEYS = Object.keys(METRIC_COPY) as Array<keyof CandidatePlan['metrics']>;

/**
 * One option, described the way a coordinator would say it: what happens,
 * how it compares with the other option, and when to choose it. The stored
 * metrics stay one click away. The browser does not re-score.
 */
export function PlanCard({
  plan,
  other,
  board,
  recommended,
  selected,
  onSelect,
}: {
  plan: CandidatePlan;
  other?: CandidatePlan;
  board: DeskBoard;
  recommended: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const valid = plan.validations.ok && plan.status !== 'REJECTED';
  const copy = PROFILE_COPY[plan.profile];
  const changes = describeChanges(board, plan);
  const vs = other ? compareToOther(plan, other) : { better: [], worse: [] };

  return (
    <div
      className={cn(
        'flex flex-[1_1_260px] flex-col rounded-lg border bg-background/40 text-left transition-colors',
        valid ? 'hover:bg-accent/40' : 'opacity-70',
        selected && 'border-primary bg-primary/5 ring-1 ring-primary',
      )}
    >
      <button
        type="button"
        onClick={valid ? onSelect : undefined}
        aria-pressed={selected}
        disabled={!valid}
        className={cn('grid gap-3 p-4 text-left', valid ? 'cursor-pointer' : 'cursor-not-allowed')}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className={cn(
                'grid size-4 place-items-center rounded-full border-2',
                selected ? 'border-primary' : 'border-muted-foreground/50',
              )}
            >
              {selected ? <span className="size-2 rounded-full bg-primary" /> : null}
            </span>
            <strong className="text-base font-semibold">{profileName(plan.profile)}</strong>
          </span>
          {recommended ? (
            <Badge variant="success">
              <Sparkles />
              Recommended
            </Badge>
          ) : null}
        </div>

        {copy ? <p className="text-sm text-muted-foreground">{copy.promise}</p> : null}

        {changes.length > 0 ? (
          <ul className="grid gap-1 text-sm">
            {changes.map((c) => (
              <li key={c} className="font-medium">
                {c}
              </li>
            ))}
          </ul>
        ) : null}

        {workloadNotes(board, plan).map((n) => (
          <p key={n} className="text-sm text-muted-foreground">
            {n}
          </p>
        ))}

        {vs.better.length + vs.worse.length > 0 ? (
          <ul className="grid gap-1 text-sm">
            {vs.better.map((b) => (
              <li key={b} className="flex items-center gap-1.5 text-success">
                <ArrowDown className="size-3.5 shrink-0" />
                {b}
              </li>
            ))}
            {vs.worse.map((w) => (
              <li key={w} className="flex items-center gap-1.5 text-warning">
                <ArrowUp className="size-3.5 shrink-0" />
                {w}
              </li>
            ))}
          </ul>
        ) : other ? (
          <p className="text-sm text-muted-foreground">Same cost as the other option on every measure.</p>
        ) : null}

        {copy ? <p className="text-xs text-muted-foreground italic">{copy.pickWhen}</p> : null}

        <div className="flex flex-wrap gap-1.5">
          {valid ? (
            <Badge variant="success" title="Skills, certificates, shifts, customer windows, parts and locked jobs all checked">
              <ShieldCheck />
              Passes all safety checks
            </Badge>
          ) : (
            <Badge variant="danger">
              <ShieldAlert />
              Can’t be used
            </Badge>
          )}
          {plan.timedOut ? <Badge variant="warning">Quick estimate (ran out of time)</Badge> : null}
        </div>
        {plan.validations.violations.length > 0 ? (
          <ul className="list-disc pl-4 text-xs text-destructive">
            {plan.validations.violations.map((v) => (
              <li key={v}>{violationCopy(v)}</li>
            ))}
          </ul>
        ) : null}
      </button>

      <details className="group border-t px-4 py-2">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
          All numbers
        </summary>
        <dl className="mt-2 grid text-sm">
          {METRIC_KEYS.map((key) => (
            <div key={key} className="flex justify-between border-t py-1.5" title={METRIC_COPY[key].help}>
              <dt className="text-muted-foreground">{METRIC_COPY[key].label}</dt>
              <dd className="font-mono tabular-nums">
                {plan.metrics[key]}
                {METRIC_COPY[key].unit ? <span className="text-muted-foreground"> {METRIC_COPY[key].unit}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
