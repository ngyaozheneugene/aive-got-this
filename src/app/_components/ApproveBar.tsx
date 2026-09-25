import { useState } from 'react';
import { Check, Info, RotateCw, Undo2, X } from 'lucide-react';
import { REJECT_REASONS } from './copy';
import { cn } from './lib/utils';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

/**
 * recommended: choosing. approved: the approval is recorded but applying it
 * failed, so only "apply" remains. rejected / committed: done.
 */
export type DecisionPhase = 'recommended' | 'approved' | 'rejected' | 'committed';

/**
 * Presentational decision control. Every decision carries a reason, which is
 * saved to the audit log; suggested reasons fill the box in one click and stay
 * editable. Approving records the approval, then applies it; the server
 * checks both steps.
 */
export function ApproveBar({
  phase,
  reason,
  onReasonChange,
  suggestions,
  planName,
  busy,
  onApprove,
  onReject,
  onRetryApply,
}: {
  phase: DecisionPhase;
  reason: string;
  onReasonChange: (value: string) => void;
  /** One-click reasons for approving the selected option. */
  suggestions: string[];
  /** The selected option's name, or undefined when none is selected. */
  planName?: string;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onRetryApply: () => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const reasonMissing = reason.trim().length === 0;

  if (phase === 'committed' || phase === 'rejected') return null;

  if (phase === 'approved') {
    return (
      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <span className="text-sm text-muted-foreground">Your approval is saved. The schedule hasn’t been updated yet.</span>
        <Button onClick={onRetryApply} disabled={busy} className="ml-auto">
          <RotateCw />
          Try updating the schedule again
        </Button>
      </div>
    );
  }

  const chips = rejecting ? REJECT_REASONS : suggestions;

  return (
    <div className="grid gap-3 border-t pt-4">
      <div className="grid gap-2">
        <span className="text-sm font-medium">
          {rejecting ? 'Why not use either option?' : planName ? `Why ${planName}?` : 'Select an option above'}
        </span>
        {chips.length > 0 && (rejecting || planName) ? (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onReasonChange(c)}
                disabled={busy}
                className={cn(
                  'rounded-full border px-3 py-1 text-left text-xs transition-colors hover:bg-accent',
                  reason === c && 'border-primary bg-primary/10 text-foreground',
                )}
              >
                {c}
              </button>
            ))}
          </div>
        ) : null}
        <Textarea
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          rows={2}
          placeholder={rejecting ? 'Or write your own…' : 'Pick a suggestion above, or write your own…'}
          disabled={busy || (!rejecting && !planName)}
          className="resize-y"
        />
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Saved with your decision so the team can see later why the schedule changed.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {rejecting ? (
          <>
            <Button variant="destructive" onClick={onReject} disabled={busy || reasonMissing}>
              <X />
              Reject both options
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setRejecting(false);
                onReasonChange('');
              }}
              disabled={busy}
            >
              <Undo2 />
              Back
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onApprove} disabled={busy || reasonMissing || !planName}>
              <Check />
              {busy ? 'Updating schedule…' : 'Approve & update schedule'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setRejecting(true);
                onReasonChange('');
              }}
              disabled={busy}
            >
              Neither works
            </Button>
            {planName && reasonMissing ? (
              <span className="text-xs text-muted-foreground">Add a reason to continue.</span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
