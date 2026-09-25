'use client';

import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { DecisionLog } from '../../shared/types/domain';
import { DeskApiError, deskApi } from './desk-api';
import { Badge } from './ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Skeleton } from './ui/skeleton';

/** UC-13. Ordered decision_log rows. Stored fields only; the desk does not re-score. */
export function TraceDrawer({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<DecisionLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    deskApi.audit(eventId).then(
      (audit) => {
        if (!cancelled) {
          setEntries([...audit.entries].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)));
        }
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof DeskApiError ? e.message : 'Could not load the trace.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-2 text-left"
        >
          <ChevronRight className={`size-4 transition-transform ${open ? 'rotate-90' : ''}`} />
          <CardTitle>How the assistant worked this out</CardTitle>
        </button>
        <CardDescription>
          Each step the assistant took, as saved in the audit log. The assistant picks the steps; the scheduling
          rules and safety checks are done by the system, not the AI.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3" hidden={!open}>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {!entries && !error ? (
          <div className="grid gap-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : null}
        {entries?.length === 0 ? <p className="text-sm text-muted-foreground">No audit rows for this event.</p> : null}
        <ol className="relative grid gap-4 border-l pl-5">
          {entries?.map((entry) => (
            <li key={entry.id} className="relative text-sm">
              <span className="absolute top-1 -left-[25px] size-2.5 rounded-full border-2 border-background bg-primary" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{entry.sequence ?? '—'}</span>
                <strong className="font-medium">{entry.stage ?? entry.playbook}</strong>
                {entry.durationMs != null ? (
                  <span className="font-mono text-xs text-muted-foreground">{entry.durationMs} ms</span>
                ) : null}
                {entry.result ? <Badge variant="secondary">{entry.result}</Badge> : null}
              </div>
              <p className="mt-1 text-muted-foreground">{entry.summary}</p>
              {entry.toolCalls.length > 0 ? (
                <details className="group mt-1">
                  <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
                    Stored tool call
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded-md border bg-background p-3 font-mono text-xs whitespace-pre-wrap">
                    {JSON.stringify(entry.toolCalls, null, 2)}
                  </pre>
                </details>
              ) : null}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
