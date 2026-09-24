'use client';

import { useEffect, useState } from 'react';
import type { DecisionLog } from '../../shared/types/domain';
import { DeskApiError, deskApi } from './desk-api';
import { card, label } from './ui';

/** UC-13. Ordered decision_log rows. Stored fields only; the desk does not re-score. */
export function TraceDrawer({ eventId }: { eventId: string }) {
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
    <section style={{ ...card, display: 'grid', gap: 8 }}>
      <span style={label}>Trace</span>
      {error ? <p style={{ margin: 0, color: '#8c2f21', fontSize: 13 }}>{error}</p> : null}
      {!entries && !error ? <p style={{ margin: 0, fontSize: 13 }}>Loading audit…</p> : null}
      {entries?.length === 0 ? <p style={{ margin: 0, fontSize: 13 }}>No audit rows for this event.</p> : null}
      <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }}>
        {entries?.map((entry) => (
          <li key={entry.id} style={{ fontSize: 13 }}>
            <strong>{entry.sequence ?? '—'}. {entry.stage ?? entry.playbook}</strong>
            {entry.durationMs != null ? <span> · {entry.durationMs} ms</span> : null}
            {entry.result ? <span> · {entry.result}</span> : null}
            <div style={{ color: '#3d3830' }}>{entry.summary}</div>
            {entry.toolCalls.length > 0 ? (
              <details>
                <summary>Stored tool call</summary>
                <pre style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0', fontSize: 12 }}>
                  {JSON.stringify(entry.toolCalls, null, 2)}
                </pre>
              </details>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
