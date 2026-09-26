'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { TraceGraph } from './TraceGraph';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

/** UC-13. The stored decision log for this event, drawn as a step graph. Stored fields only. */
export function TraceDrawer({
  eventId,
  refreshKey,
  awaitingDecision,
}: {
  eventId: string;
  refreshKey?: unknown;
  awaitingDecision?: boolean;
}) {
  const [open, setOpen] = useState(false);

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
          The AI picks the steps. The rules and safety checks are run by the system, and only you can change the
          schedule.
        </CardDescription>
      </CardHeader>
      {open ? (
        <CardContent>
          <TraceGraph eventId={eventId} refreshKey={refreshKey} awaitingDecision={awaitingDecision} />
        </CardContent>
      ) : null}
    </Card>
  );
}
