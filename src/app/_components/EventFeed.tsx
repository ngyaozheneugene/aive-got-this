'use client';

import { useEffect, useState } from 'react';
import { ChevronRight, Inbox, PhoneCall, Smartphone } from 'lucide-react';
import type { OperationalEvent } from '../../shared/types/domain';
import { eventStatusCopy } from './copy';
import { DeskApiError, deskApi } from './desk-api';
import { findDisruption } from './disruptions';
import { cn } from './lib/utils';
import { TraceGraph } from './TraceGraph';
import { Badge } from './ui/badge';

/** An event this desk received, newest first. The status always comes from the server. */
export interface FeedItem {
  eventId: string;
  disruptionKey: string;
}

export type FeedStatuses = Record<string, OperationalEvent | 'missing'>;

/**
 * Live status for each feed item, refetched whenever `refreshKey` changes
 * (an event arrives, options are ready, a decision is saved). An event the
 * server no longer knows — after a demo reset or a restart — comes back
 * 'missing' so the feed can drop it.
 */
export function useEventStatuses(items: FeedItem[], refreshKey: unknown): FeedStatuses {
  const [statuses, setStatuses] = useState<FeedStatuses>({});
  const ids = items.map((i) => i.eventId).join(',');

  useEffect(() => {
    let cancelled = false;
    const list = ids ? ids.split(',') : [];
    Promise.all(
      list.map((id) =>
        deskApi.getEvent(id).then(
          (event) => [id, event] as const,
          (e: unknown) => [id, e instanceof DeskApiError && e.status === 404 ? ('missing' as const) : null] as const,
        ),
      ),
    ).then((rows) => {
      if (cancelled) return;
      setStatuses((prev) => {
        const next: FeedStatuses = {};
        for (const [id, value] of rows) {
          const kept = value ?? prev[id];
          if (kept) next[id] = kept;
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [ids, refreshKey]);

  return statuses;
}

/** Singapore wall-clock time for a server timestamp. */
export function receivedTime(iso: string | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-SG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore' }).format(
    new Date(iso),
  );
}

export function SourceIcon({ source, className }: { source: string; className?: string }) {
  const Icon = source.toLowerCase().includes('customer') ? PhoneCall : Smartphone;
  return <Icon className={className} />;
}

/**
 * Today's events: everything that has come in, what it is waiting on, and —
 * one click away — how it was handled, step by step.
 */
export function EventFeed({
  items,
  statuses,
  refreshKey,
  currentEventId,
  onOpenCurrent,
}: {
  items: FeedItem[];
  statuses: FeedStatuses;
  refreshKey: unknown;
  currentEventId?: string;
  onOpenCurrent: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const visible = items.filter((i) => statuses[i.eventId] !== 'missing');

  if (visible.length === 0) {
    return (
      <div className="grid place-items-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground">
        <Inbox className="size-6" />
        <p>
          Nothing has come in yet today. Customer calls and updates from the technician app appear here as they
          arrive.
        </p>
      </div>
    );
  }

  return (
    <ol className="grid grid-cols-1 divide-y">
      {visible.map((item) => {
        const d = findDisruption(item.disruptionKey);
        const event = statuses[item.eventId];
        const status = event && event !== 'missing' ? eventStatusCopy(event.status) : { label: 'Checking…', tone: 'secondary' as const, open: true };
        const isCurrent = item.eventId === currentEventId;
        const isOpen = expanded === item.eventId;
        return (
          <li key={item.eventId} className={cn('grid min-w-0 grid-cols-1 gap-2 px-3 py-2.5', isCurrent && status.open && 'bg-warning/5')}>
            <div className="flex min-w-0 items-start gap-2.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-secondary">
                <SourceIcon source={d.source} className="size-3.5 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="font-mono">{event && event !== 'missing' ? receivedTime(event.receivedAt) : '—'}</span>
                  <span>·</span>
                  <span className="truncate">{d.source}</span>
                </div>
                <p className="text-sm leading-snug font-medium">{d.headline}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <Badge variant={status.tone}>{status.label}</Badge>
                  {isCurrent && status.open ? (
                    <button type="button" onClick={onOpenCurrent} className="text-xs text-primary hover:underline">
                      Open
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : item.eventId)}
                    aria-expanded={isOpen}
                    className="ml-auto flex shrink-0 items-center gap-1 text-xs whitespace-nowrap text-muted-foreground hover:text-foreground"
                  >
                    What happened
                    <ChevronRight className={cn('size-3 transition-transform', isOpen && 'rotate-90')} />
                  </button>
                </div>
              </div>
            </div>
            {isOpen ? (
              <div className="min-w-0 pl-9">
                <TraceGraph eventId={item.eventId} refreshKey={refreshKey} awaitingDecision={status.open} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
