'use client';

import { ChevronRight, Lock, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CandidatePlan, DeskBoard, DeskJobRow } from '../../shared/types/domain';
import { clock, techColor } from './geo';
import { cn } from './lib/utils';
import { buildScheduleView, type ScheduleSlot } from './schedule-view';

/**
 * The right-hand list: jobs that still need a technician, then the team. Each
 * person has a day bar (every job on one line, 07:00 to 18:00, so free time is
 * easy to compare) and their stops in order, numbered to match the pins on the
 * map. With a plan selected, the list shows the plan's version of the day.
 */
export function TechList({
  board,
  plan,
  unavailableTechId,
  focusTechId,
  pinnedTechId,
  onFocusTech,
  onPinTech,
  onOpenJob,
}: {
  board: DeskBoard;
  plan?: CandidatePlan;
  unavailableTechId?: string;
  focusTechId?: string;
  pinnedTechId?: string;
  onFocusTech: (technicianId: string | undefined) => void;
  onPinTech: (technicianId: string) => void;
  /** Opens the event behind a job that needs a technician, when there is one. */
  onOpenJob?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const view = useMemo(() => buildScheduleView(board, plan), [board, plan]);
  const techIds = board.technicians.map((t) => t.technician.id);
  const q = query.trim().toLowerCase();
  const matches = (...xs: Array<string | undefined>) => !q || xs.some((x) => x?.toLowerCase().includes(q));

  const slotByJob = new Map(view.slots.map((s) => [s.jobId, s]));
  const waiting = board.jobs.filter((r) => !r.assignment);
  const shownWaiting = waiting.filter((r) => matches(r.customer.name, r.site.addressLine1, r.job.priority));

  const expand = (id: string, open: boolean) =>
    setExpanded((prev) => {
      if (prev.has(id) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });

  // Pinning someone opens their stops, and so does any change the selected
  // option makes to their day. After that, the chevron alone opens and closes.
  useEffect(() => {
    if (pinnedTechId) expand(pinnedTechId, true);
  }, [pinnedTechId]);
  useEffect(() => {
    for (const s of view.slots) {
      if (s.change === 'unchanged') continue;
      expand(s.technicianId, true);
      if (s.previous) expand(s.previous.technicianId, true);
    }
    // Once per selected plan, not on every render.
  }, [plan?.id]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <label className="m-2.5 flex items-center gap-2 rounded-lg border bg-background/60 px-2.5 py-1.5 text-muted-foreground focus-within:border-ring">
        <Search className="size-3.5 shrink-0" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search technicians, customers, streets"
          aria-label="Search technicians and jobs"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <SectionHead title="Needs a technician" note={waiting.length === 0 ? 'None' : `${waiting.length} job${waiting.length === 1 ? '' : 's'}`} />
        {shownWaiting.length === 0 ? (
          <p className="border-b px-3.5 py-3 text-xs text-muted-foreground">
            {waiting.length === 0 ? 'Every job has a technician.' : 'No matches.'}
          </p>
        ) : (
          shownWaiting.map((r) => (
            <WaitingJob
              key={r.job.id}
              row={r}
              planned={slotByJob.get(r.job.id)}
              plannedName={board.technicians.find((t) => t.technician.id === slotByJob.get(r.job.id)?.technicianId)?.technician.name}
              onOpen={onOpenJob}
            />
          ))
        )}

        <SectionHead title="Eastwind Aircon · field team" note={`${board.technicians.length} on duty`} />
        {board.technicians.map(({ technician, loadMinutes }) => {
          const stops = view.slots.filter((s) => s.technicianId === technician.id);
          const leaving = view.slots.filter((s) => s.previous?.technicianId === technician.id && s.technicianId !== technician.id);
          if (!matches(technician.name, technician.currentCluster, ...stops.flatMap((s) => [s.row.customer.name, s.row.site.addressLine1]))) return null;
          const color = techColor(techIds, technician.id);
          const off = technician.id === unavailableTechId;
          const changed = stops.filter((s) => s.change !== 'unchanged').length;
          const open = expanded.has(technician.id) || Boolean(q);
          const dim = focusTechId !== undefined && focusTechId !== technician.id;
          return (
            <div
              key={technician.id}
              onMouseEnter={() => onFocusTech(technician.id)}
              onMouseLeave={() => onFocusTech(undefined)}
              // Pinned: a bar in their colour down the left edge.
              style={pinnedTechId === technician.id ? { boxShadow: `inset 3px 0 0 ${color}` } : undefined}
              className={cn(
                ROW_GRID,
                'border-b px-2.5 transition-[opacity,background-color] duration-150 hover:bg-accent/25',
                pinnedTechId === technician.id && 'bg-accent/40 hover:bg-accent/40',
                dim && 'opacity-50',
              )}
            >
              {/* Opens and closes the stops only; it never moves the map. */}
              <button
                type="button"
                onClick={() => expand(technician.id, !open)}
                aria-expanded={open}
                aria-label={`${open ? 'Hide' : 'Show'} ${technician.name}’s stops`}
                className={cn(
                  'col-start-1 row-start-1 mt-[18px] grid size-5 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground',
                  FOCUS,
                )}
              >
                <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
              </button>

              {/* Pins the technician: the map moves to their day. */}
              <button
                type="button"
                onClick={() => onPinTech(technician.id)}
                aria-pressed={pinnedTechId === technician.id}
                title={pinnedTechId === technician.id ? 'Click to show everyone again' : 'Click to show their day on the map'}
                className={cn(
                  'col-span-3 col-start-2 row-start-1 grid grid-cols-subgrid items-center gap-y-2 rounded-md py-2.5 text-left',
                  FOCUS,
                )}
              >
                <span className="size-2.5 justify-self-center rounded-full ring-3 ring-white/5" style={{ background: color }} />
                <span className="min-w-0">
                  <span className={cn('block truncate text-[13px] font-semibold', off && 'text-muted-foreground line-through')}>
                    {technician.name}
                  </span>
                  <span className={cn('block truncate text-[11.5px]', off ? 'text-destructive' : 'text-muted-foreground')}>
                    {off ? 'Unavailable today' : `${cap(technician.currentCluster)} · ${stops.length} job${stops.length === 1 ? '' : 's'} · ${loadMinutes} min booked`}
                  </span>
                </span>
                <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  {changed > 0 ? (
                    <span className="rounded-full border border-warning/30 bg-warning/10 px-1.5 text-[10.5px] font-semibold text-warning">
                      +{changed}
                    </span>
                  ) : null}
                  <Pin color={color} />
                  <span className="font-mono tabular-nums">{stops.length}</span>
                </span>
                <DayBar stops={stops} leaving={leaving} color={color} off={off} startHour={DAY_START} endHour={DAY_END} />
              </button>

              {open ? (
                <ol className="col-span-4 grid grid-cols-subgrid pb-2.5">
                  {stops.map((s, i) => (
                    <Stop key={s.jobId} n={i + 1} slot={s} color={color} />
                  ))}
                  {leaving.map((s) => (
                    <li key={`away-${s.jobId}`} className="col-span-4 grid grid-cols-subgrid border-t py-1.5 text-[11.5px] text-muted-foreground">
                      <span className="col-start-3 truncate">
                        <span className="line-through">{s.row.site.addressLine1}</span>{' '}
                        <span className="text-warning">
                          → {board.technicians.find((t) => t.technician.id === s.technicianId)?.technician.name ?? 'someone else'}
                        </span>
                      </span>
                    </li>
                  ))}
                  {stops.length === 0 && leaving.length === 0 ? (
                    <li className="col-span-4 grid grid-cols-subgrid py-1.5 text-[11.5px] text-muted-foreground">
                      <span className="col-start-3">No jobs today.</span>
                    </li>
                  ) : null}
                </ol>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="sticky top-0 z-[1] flex items-baseline justify-between border-b bg-card px-3.5 py-2">
      <span className="text-xs font-semibold">{title}</span>
      <span className="text-[11.5px] text-muted-foreground">{note}</span>
    </div>
  );
}

function WaitingJob({
  row,
  planned,
  plannedName,
  onOpen,
}: {
  row: DeskJobRow;
  planned?: ScheduleSlot;
  plannedName?: string;
  onOpen?: () => void;
}) {
  const ws = row.job.windowStart?.slice(11, 16);
  const we = row.job.windowEnd?.slice(11, 16);
  const urgent = row.job.priority === 'urgent';
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      className={cn(ROW_GRID, 'w-full items-start border-b bg-destructive/[0.06] px-2.5 py-3 text-left enabled:hover:bg-destructive/10', FOCUS)}
    >
      <span className="col-start-2 mt-0.5 justify-self-center">
        <Pin color="var(--destructive)" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold">{row.customer.name}</span>
        <span className="block truncate text-[11.5px] text-muted-foreground">{row.site.addressLine1}</span>
        {ws && we ? <span className="block font-mono text-[11px] text-muted-foreground">Window {ws}–{we}</span> : null}
      </span>
      {planned ? (
        <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap text-warning">
          Preview: {plannedName ?? '—'}
        </span>
      ) : (
        <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap text-destructive">
          {urgent ? 'Urgent' : row.job.priority}
        </span>
      )}
    </button>
  );
}

function Stop({ n, slot, color }: { n: number; slot: ScheduleSlot; color: string }) {
  const moved = slot.change !== 'unchanged';
  const locked = slot.row.job.lockState && slot.row.job.lockState !== 'none';
  const tag = slot.change === 'added' ? 'New' : slot.change === 'reassigned' ? 'Moved here' : slot.change === 'retimed' ? 'New time' : null;
  return (
    <li
      className={cn(
        'col-span-4 grid grid-cols-subgrid items-start border-t py-1.5 first:border-t-0',
        // An outline rather than padding, so the columns stay aligned.
        moved && 'my-1 rounded-md border-t-0 bg-warning/[0.07] outline-1 outline-offset-[3px] outline-warning/35',
      )}
    >
      <span className="pt-px text-center font-mono text-[11px] text-muted-foreground">{n}</span>
      <span className="mt-0.5 justify-self-center">
        <Pin color={moved ? 'var(--warning)' : color} />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-[12.5px] font-semibold">
          {locked ? <Lock className="size-3 shrink-0 text-muted-foreground" /> : null}
          <span className="truncate">{slot.row.site.addressLine1}</span>
        </span>
        <span className="block truncate text-[11.5px] text-muted-foreground">
          {slot.row.customer.name}
          {tag ? <span className="text-warning"> · {tag}</span> : null}
          {moved && slot.travelBeforeMinutes ? <span> · {slot.travelBeforeMinutes} min drive</span> : null}
        </span>
      </span>
      <span className="text-right font-mono text-[11px] leading-tight text-muted-foreground">
        {clock(slot.start)}
        <br />
        {clock(slot.end)}
      </span>
    </li>
  );
}

// Every row shares these columns: chevron or stop number, dot or pin, text,
// and count or time. The stops and the day bar sit in the same columns, so
// everything lines up down the list.
const ROW_GRID = 'grid grid-cols-[20px_12px_minmax(0,1fr)_auto] gap-x-2.5';
const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-ring/60';

const DAY_START = 7;
const DAY_END = 18;
const TICKS = [9, 12, 15];

/**
 * One technician's whole day on a line. Jobs are blocks; a job the selected
 * option adds or moves is amber; where a moved job used to be is a dashed
 * outline. The gaps are free time.
 */
function DayBar({
  stops,
  leaving,
  color,
  off,
  startHour,
  endHour,
}: {
  stops: ScheduleSlot[];
  leaving: ScheduleSlot[];
  color: string;
  off: boolean;
  startHour: number;
  endHour: number;
}) {
  const span = (endHour - startHour) * 60;
  const x = (m: number) => `${Math.max(0, Math.min(100, ((m - startHour * 60) / span) * 100))}%`;
  const w = (a: number, b: number) => `${Math.max(0.8, ((Math.min(b, endHour * 60) - Math.max(a, startHour * 60)) / span) * 100)}%`;
  const ghosts = [
    ...stops.filter((s) => s.change === 'retimed' && s.previous),
    ...leaving,
  ];
  return (
    <span className="relative col-span-2 col-start-2 mb-3 block h-3.5 rounded-[4px] bg-white/[0.05]" aria-hidden>
      {off ? (
        <span className="absolute inset-0 rounded-[4px] bg-[repeating-linear-gradient(135deg,rgb(239_68_68/0.14)_0_5px,transparent_5px_10px)]" />
      ) : null}
      {TICKS.map((h) => (
        <span key={h} className="absolute inset-y-0 border-l border-white/[0.07]" style={{ left: x(h * 60) }}>
          <span className="absolute top-full mt-0.5 -translate-x-1/2 font-mono text-[9px] text-muted-foreground/70">
            {String(h).padStart(2, '0')}
          </span>
        </span>
      ))}
      {ghosts.map((s) => (
        <span
          key={`ghost-${s.jobId}`}
          title={`Was here: ${s.row.customer.name}, ${clock(s.previous!.start)}–${clock(s.previous!.end)}`}
          className="absolute inset-y-0 rounded-[3px] border border-dashed border-muted-foreground/60"
          style={{ left: x(s.previous!.start), width: w(s.previous!.start, s.previous!.end) }}
        />
      ))}
      {stops.map((s) => {
        const moved = s.change !== 'unchanged';
        return (
          <span
            key={s.jobId}
            title={`${s.row.customer.name}, ${clock(s.start)}–${clock(s.end)}`}
            className={cn('absolute inset-y-0 rounded-[3px]', moved && 'shadow-[0_0_8px_rgb(245_158_11/0.6)]')}
            style={{ left: x(s.start), width: w(s.start, s.end), background: moved ? 'var(--warning)' : color, opacity: off ? 0.35 : 0.9 }}
          />
        );
      })}
    </span>
  );
}

function Pin({ color }: { color: string }) {
  return (
    <svg width="12" height="15" viewBox="0 0 24 30" aria-hidden className="shrink-0">
      <path d="M12 30C9 24 0 20 0 12a12 12 0 0 1 24 0c0 8-9 12-12 18Z" fill={color} />
    </svg>
  );
}

function cap(s: string | null | undefined): string {
  if (!s) return '—';
  return s === 'cbd' ? 'CBD' : s.charAt(0).toUpperCase() + s.slice(1);
}
