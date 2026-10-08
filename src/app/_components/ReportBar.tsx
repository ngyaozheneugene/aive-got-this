'use client';

import { CornerDownLeft, Loader2, MessageSquareText, Sparkles, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { DeskApiError, deskApi, type ReadReportResult, type ReportDraft } from './desk-api';
import { cn } from './lib/utils';

const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-ring/60';

const EXAMPLES = [
  'Kumar’s van broke down, he’s out till 2pm',
  'Who’s free at 3pm for a water leak?',
  'The Bedok North job needs another 45 minutes',
  'New customer Tan, 9123 4567, 529536 Tampines St 81, leaking aircon, 2 to 5pm',
];

type Actionable = Exclude<ReportDraft, { kind: 'clarify' } | { kind: 'answer' }>;

const CONFIRM_LABEL: Record<Actionable['kind'], string> = {
  unavailable: 'Find options',
  overrun: 'Find options',
  place_job: 'Find options',
  booking: 'Book and find options',
};

/**
 * "What happened?" The coordinator types it the way they would say it; the
 * assistant reads it into one change, and nothing happens until they confirm.
 * Confirming runs the same path as the board's own controls, so the plans,
 * approval and commit that follow are unchanged.
 */
export function ReportBar({
  disabled,
  onConfirm,
}: {
  /** Off while another event is being decided, or when looking ahead. */
  disabled: boolean;
  /** Act on a confirmed draft. Returns an error to show, or null. */
  onConfirm: (draft: Actionable, quoted: string) => Promise<string | null>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReadReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const abort = useRef<AbortController | null>(null);

  const read = async (report: string) => {
    const trimmed = report.trim();
    if (!trimmed || busy) return;
    abort.current?.abort();
    abort.current = new AbortController();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await deskApi.readReport(trimmed, abort.current.signal));
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError(e instanceof DeskApiError ? (e.detail ?? e.code) : 'Could not read that. Try again, or use the controls on the board.');
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    abort.current?.abort();
    setText('');
    setResult(null);
    setError(null);
    setAnswer('');
    setBusy(false);
  };

  // A clarification is answered by reading the report again with the answer added.
  const reply = (with_: string) => {
    const next = `${result?.quoted ?? text}\nAnswer: ${with_}`.slice(0, 500);
    setText(next);
    setAnswer('');
    void read(next);
  };

  const confirm = async () => {
    if (!result || result.draft.kind === 'clarify' || result.draft.kind === 'answer') return;
    setBusy(true);
    const message = await onConfirm(result.draft, result.quoted);
    setBusy(false);
    if (message) setError(message);
    else clear();
  };

  const draft = result?.draft;

  // Only the button's word: the assistant still decides whether it is a question or a report.
  const asking = QUESTION.test(text.trim());

  return (
    <section aria-label="Report what happened" className="grid gap-2 border-b px-2.5 py-2.5">
      <form
        className={cn('grid grid-cols-[minmax(0,1fr)_auto] items-end gap-1.5 rounded-lg border bg-background/60 p-1.5 focus-within:border-ring', disabled && 'opacity-60')}
        onSubmit={(e) => {
          e.preventDefault();
          void read(text);
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 500))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void read(text);
            }
            if (e.key === 'Escape') clear();
          }}
          disabled={disabled}
          rows={text.length > 60 ? 3 : 1}
          placeholder="What happened, or ask a question…"
          aria-label="What happened?"
          className="min-h-7 resize-none bg-transparent px-1.5 py-1 text-[13px] outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={disabled || busy || !text.trim()}
          className={cn('inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-[11.5px] font-semibold text-primary-foreground disabled:opacity-40', FOCUS)}
          title={`${asking ? 'Ask' : 'Send'} (Enter)`}
        >
          {busy && !result ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {asking ? 'Ask' : 'Send'}
        </button>
      </form>

      {!text && !result && !busy && !disabled ? (
        <span className="flex flex-wrap gap-1">
          {EXAMPLES.map((e) => (
            <button key={e} type="button" onClick={() => setText(e)} className={cn('truncate rounded-full border px-2 py-0.5 text-[10.5px] text-muted-foreground hover:bg-accent hover:text-foreground', FOCUS)}>
              {e}
            </button>
          ))}
        </span>
      ) : null}

      {busy && !result ? (
        <span className="flex items-center gap-1.5 px-1 text-[11.5px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Checking the board…
        </span>
      ) : null}

      {error ? (
        <span role="alert" className="flex items-start justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11.5px] text-destructive">
          {error}
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss" className={FOCUS}>
            <X className="size-3.5" />
          </button>
        </span>
      ) : null}

      {draft?.kind === 'answer' ? (
        <div className="grid gap-1.5 rounded-lg border bg-accent/30 p-2.5" aria-live="polite">
          <span className="text-[11.5px] text-muted-foreground italic">“{result!.quoted}”</span>
          <span className="text-[13px] leading-snug whitespace-pre-line">{draft.text}</span>
          {draft.basedOn.length ? (
            <span className="grid gap-0.5 border-t pt-1.5 text-[11px] text-muted-foreground">
              <span className="font-medium">Based on</span>
              {draft.basedOn.map((b) => (
                <span key={b}>· {b}</span>
              ))}
            </span>
          ) : null}
          <span className="flex justify-end">
            <button type="button" onClick={clear} className={cn('rounded-md border px-2 py-1 text-[11.5px] hover:bg-accent', FOCUS)}>
              Done
            </button>
          </span>
        </div>
      ) : null}

      {draft && draft.kind !== 'clarify' && draft.kind !== 'answer' ? (
        <div className="grid gap-1.5 rounded-lg border border-primary/40 bg-primary/5 p-2.5">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
            <MessageSquareText className="size-3.5" /> I read that as
          </span>
          <span className="text-[13px] font-semibold">{draft.summary}</span>
          <span className="text-[11.5px] text-muted-foreground italic">“{result!.quoted}”</span>
          <span className="text-[11px] text-muted-foreground">Nothing changes yet: you’ll see the options and approve one.</span>
          <span className="flex items-center justify-end gap-1.5">
            <button type="button" onClick={clear} className={cn('rounded-md px-1.5 py-1 text-[11.5px] text-muted-foreground hover:text-foreground', FOCUS)}>
              Discard
            </button>
            <button type="button" onClick={() => setResult(null)} className={cn('rounded-md border px-2 py-1 text-[11.5px] hover:bg-accent', FOCUS)}>
              Edit
            </button>
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={busy || disabled}
              className={cn('inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11.5px] font-semibold text-primary-foreground disabled:opacity-40', FOCUS)}
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : null}
              {CONFIRM_LABEL[draft.kind]}
            </button>
          </span>
        </div>
      ) : null}

      {draft?.kind === 'clarify' ? (
        <div className="grid gap-1.5 rounded-lg border border-warning/40 bg-warning/5 p-2.5">
          <span className="text-[12.5px] font-medium">{draft.question}</span>
          {draft.options.length ? (
            <span className="flex flex-wrap gap-1">
              {draft.options.map((o) => (
                <button key={o} type="button" onClick={() => reply(o)} className={cn('rounded-md border px-1.5 py-0.5 text-[11px] hover:bg-accent', FOCUS)}>
                  {o}
                </button>
              ))}
            </span>
          ) : null}
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (answer.trim()) reply(answer.trim());
            }}
          >
            <input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Your answer"
              aria-label="Answer"
              className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1 text-[12px] outline-none focus:border-ring"
            />
            <button type="submit" disabled={!answer.trim()} aria-label="Send answer" className={cn('grid size-7 place-items-center rounded-md bg-primary text-primary-foreground disabled:opacity-40', FOCUS)}>
              <CornerDownLeft className="size-3.5" />
            </button>
            <button type="button" onClick={clear} aria-label="Start over" className={cn('grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent', FOCUS)}>
              <X className="size-3.5" />
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}

/** Reads like a question: ends with "?" or opens with a question word. */
const QUESTION = /\?$|^(who|what|whats|what's|when|where|why|how|which|is|are|can|could|does|do|will|should|any)\b/i;
