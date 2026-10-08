'use client';

import { ChevronRight, Clock, FileSpreadsheet, Lock, Plus, Search, UserX } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CandidatePlan, DeskBoard, DeskJobRow, Shift } from '../../shared/types/domain';
import type { Availability } from './disruptions';
import { clock, minutesOfDay, techColor } from './geo';
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
  onFindTechnician,
  onMarkUnavailable,
  onReportLate,
  onNewJob,
  onImportJobs,
  newJobForm,
  teamName = 'Field team',
  reportBar,
}: {
  board: DeskBoard;
  /** Heading over the technicians. */
  teamName?: string;
  /** "What happened?": typed reports, above everything else. */
  reportBar?: ReactNode;
  plan?: CandidatePlan;
  unavailableTechId?: string;
  focusTechId?: string;
  pinnedTechId?: string;
  onFocusTech: (technicianId: string | undefined) => void;
  onPinTech: (technicianId: string) => void;
  /** Opens the event behind a job that needs a technician, when there is one. */
  onOpenJob?: () => void;
  /** Ask for options for a waiting job; absent while something else is being decided. */
  onFindTechnician?: (row: DeskJobRow) => void;
  /** Report a technician away for some or all of the day; absent when reporting is not possible. */
  onMarkUnavailable?: (technicianId: string, availability: Availability) => void;
  /** Report a booked job running late; absent when reporting is not possible. */
  onReportLate?: (row: DeskJobRow, minutes: number) => void;
  /** Open the new-job form; absent when booking is not possible. */
  onNewJob?: () => void;
  /** Open the batch job import dialog; absent when booking is not possible. */
  onImportJobs?: () => void;
  /** The open new-job form, shown above the waiting jobs. */
  newJobForm?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // One report form open at a time: away for a technician, or late for a job.
  const [form, setForm] = useState<{ kind: 'away'; id: string } | { kind: 'late'; id: string } | null>(null);
  const view = useMemo(() => buildScheduleView(board, plan), [board, plan]);
  const hours = (hhmm: string) => Number(hhmm.slice(0, 2)) + Number(hhmm.slice(3)) / 60;
  const dayStartHour = Math.min(DAY_START, Math.floor(hours(board.workingDay?.start ?? '08:00')) - 1);
  const dayEndHour = Math.max(DAY_END, Math.ceil(hours(board.workingDay?.end ?? '18:00')));
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
      {reportBar}
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
        <SectionHead
          title="Needs a technician"
          note={waiting.length === 0 ? 'None' : `${waiting.length} job${waiting.length === 1 ? '' : 's'}`}
          action={
            <div className="flex items-center gap-1">
              {onImportJobs && !newJobForm ? (
                <button
                  type="button"
                  onClick={onImportJobs}
                  className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium hover:bg-accent', FOCUS)}
                  title="Book jobs from a CSV, Excel or Parquet file"
                >
                  <FileSpreadsheet className="size-3 text-primary" />
                  Import
                </button>
              ) : null}
              {onNewJob && !newJobForm ? (
                <button
                  type="button"
                  onClick={onNewJob}
                  className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium hover:bg-accent', FOCUS)}
                >
                  <Plus className="size-3" />
                  New job
                </button>
              ) : null}
            </div>
          }
        />
        {newJobForm}
        {view.leftForCall.map(({ row, previous }) => (
          <div key={`call-${row.job.id}`} className={cn(ROW_GRID, 'items-start border-b bg-warning/[0.07] px-2.5 py-3')}>
            <span className="col-start-2 mt-0.5 justify-self-center">
              <Pin color="var(--warning)" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold">{row.customer.name}</span>
              <span className="block truncate text-[11.5px] text-muted-foreground">{row.site.addressLine1}</span>
              {previous ? (
                <span className="block font-mono text-[11px] text-muted-foreground">
                  Was {clock(previous.start)}–{clock(previous.end)} with{' '}
                  {board.technicians.find((t) => t.technician.id === previous.technicianId)?.technician.name ?? '—'}
                </span>
              ) : null}
            </span>
            <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap text-warning">
              Preview: call customer
            </span>
          </div>
        ))}
        {shownWaiting.length === 0 ? (
          <p className="border-b px-3.5 py-3 text-xs text-muted-foreground">
            {board.jobs.length === 0 ? 'No jobs booked for this day yet.' : waiting.length === 0 ? 'Every job has a technician.' : 'No matches.'}
          </p>
        ) : (
          shownWaiting.map((r) => (
            <WaitingJob
              key={r.job.id}
              row={r}
              planned={slotByJob.get(r.job.id)}
              plannedName={board.technicians.find((t) => t.technician.id === slotByJob.get(r.job.id)?.technicianId)?.technician.name}
              onOpen={onOpenJob}
              onFind={onFindTechnician ? () => onFindTechnician(r) : undefined}
            />
          ))
        )}

        <SectionHead title={teamName} note={`${board.technicians.length} on duty`} />
        {board.technicians.map(({ technician, loadMinutes, shift }) => {
          const stops = view.slots.filter((s) => s.technicianId === technician.id);
          const leaving = view.slots.filter((s) => s.previous?.technicianId === technician.id && s.technicianId !== technician.id);
          if (!matches(technician.name, technician.currentCluster, ...stops.flatMap((s) => [s.row.customer.name, s.row.site.addressLine1]))) return null;
          const color = techColor(techIds, technician.id);
          const sick = shift?.status === 'mc' || shift?.status === 'no_show';
          const off = technician.id === unavailableTechId || sick;
          const hours = shiftNote(shift);
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
                    {sick ? 'Off sick today' : off ? 'Unavailable today' : `${cap(technician.currentCluster)} · ${stops.length} job${stops.length === 1 ? '' : 's'} · ${loadMinutes} min booked`}
                  </span>
                  {hours && !sick ? <span className="block truncate text-[11px] text-warning">{hours}</span> : null}
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
                <DayBar stops={stops} leaving={leaving} color={color} off={off} shift={shift} startHour={dayStartHour} endHour={dayEndHour} />
              </button>

              {open ? (
                <ol className="col-span-4 grid grid-cols-subgrid pb-2.5">
                  {stops.map((s, i) => (
                    <Stop
                      key={s.jobId}
                      n={i + 1}
                      slot={s}
                      color={color}
                      lateOpen={form?.kind === 'late' && form.id === s.jobId}
                      onLate={onReportLate && !plan ? () => setForm(form?.kind === 'late' && form.id === s.jobId ? null : { kind: 'late', id: s.jobId }) : undefined}
                      onSendLate={onReportLate ? (minutes) => { setForm(null); onReportLate(s.row, minutes); } : undefined}
                    />
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
                  {onMarkUnavailable && !plan && !sick ? (
                    <li className="col-span-4 grid grid-cols-subgrid border-t pt-2">
                      <span className="col-span-2 col-start-2">
                        {form?.kind === 'away' && form.id === technician.id ? (
                          <AwayForm
                            name={technician.name}
                            onCancel={() => setForm(null)}
                            onSend={(a) => { setForm(null); onMarkUnavailable(technician.id, a); }}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setForm({ kind: 'away', id: technician.id })}
                            className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] text-muted-foreground hover:bg-accent hover:text-foreground', FOCUS)}
                          >
                            <UserX className="size-3.5" />
                            Mark {technician.name} unavailable
                          </button>
                        )}
                      </span>
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

function SectionHead({ title, note, action }: { title: string; note: string; action?: ReactNode }) {
  return (
    <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 border-b bg-card px-3.5 py-2">
      <span className="text-xs font-semibold">{title}</span>
      <span className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
        {note}
        {action}
      </span>
    </div>
  );
}

function WaitingJob({
  row,
  planned,
  plannedName,
  onOpen,
  onFind,
}: {
  row: DeskJobRow;
  planned?: ScheduleSlot;
  plannedName?: string;
  /** Open the event already handling this job. */
  onOpen?: () => void;
  /** Ask the assistant for options for this job. */
  onFind?: () => void;
}) {
  const ws = row.job.windowStart?.slice(11, 16);
  const we = row.job.windowEnd?.slice(11, 16);
  const urgent = row.job.priority === 'urgent';
  return (
    <button
      type="button"
      onClick={onOpen ?? onFind}
      disabled={!onOpen && !onFind}
      title={onOpen ? 'Open the options for this job' : onFind ? 'Ask the assistant for options for this job' : undefined}
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
      ) : onFind && !onOpen ? (
        <span className="grid justify-items-end gap-1">
          <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap text-destructive">
            {urgent ? 'Urgent' : row.job.priority}
          </span>
          <span className="rounded-md bg-primary px-2 py-1 text-[11px] font-semibold whitespace-nowrap text-primary-foreground">
            Find a technician
          </span>
        </span>
      ) : (
        <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap text-destructive">
          {urgent ? 'Urgent' : row.job.priority}
        </span>
      )}
    </button>
  );
}

function Stop({
  n,
  slot,
  color,
  lateOpen,
  onLate,
  onSendLate,
}: {
  n: number;
  slot: ScheduleSlot;
  color: string;
  lateOpen?: boolean;
  /** Toggle the "running late" form; absent when reporting is off. */
  onLate?: () => void;
  onSendLate?: (minutes: number) => void;
}) {
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
      <span className="flex items-start justify-end gap-1">
        <span className="text-right font-mono text-[11px] leading-tight text-muted-foreground">
          {clock(slot.start)}
          <br />
          {clock(slot.end)}
        </span>
        {onLate ? (
          <button
            type="button"
            onClick={onLate}
            aria-expanded={lateOpen}
            title="This job is running late"
            aria-label={`${slot.row.site.addressLine1} is running late`}
            className={cn('grid size-5 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground', lateOpen && 'bg-accent text-foreground', FOCUS)}
          >
            <Clock className="size-3" />
          </button>
        ) : null}
      </span>
      {lateOpen && onSendLate ? (
        <span className="col-span-2 col-start-3 pt-1.5">
          <LateForm onSend={onSendLate} onCancel={onLate!} />
        </span>
      ) : null}
    </li>
  );
}

const LATE_CHOICES = [15, 30, 45, 60, 90, 120];

/** How late: one tap for the usual amounts, or any number of minutes. */
function LateForm({ onSend, onCancel }: { onSend: (minutes: number) => void; onCancel: () => void }) {
  const [custom, setCustom] = useState('');
  const minutes = Number(custom);
  const valid = Number.isInteger(minutes) && minutes > 0 && minutes <= 480;
  return (
    <span className="grid gap-1.5 rounded-md border bg-background/60 p-2">
      <span className="text-[11.5px] font-medium">Running late by</span>
      <span className="flex flex-wrap gap-1">
        {LATE_CHOICES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onSend(m)}
            className={cn('rounded-md border px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent', FOCUS)}
          >
            {m}m
          </button>
        ))}
      </span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          min={1}
          max={480}
          inputMode="numeric"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid) onSend(minutes);
            if (e.key === 'Escape') onCancel();
          }}
          placeholder="Other"
          aria-label="Minutes late"
          className="w-16 rounded-md border bg-transparent px-1.5 py-0.5 font-mono text-[11px] outline-none focus:border-ring"
        />
        <span className="text-[11px] text-muted-foreground">min</span>
        <button
          type="button"
          disabled={!valid}
          onClick={() => onSend(minutes)}
          className={cn('ml-auto rounded-md bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground disabled:opacity-40', FOCUS)}
        >
          Send
        </button>
      </span>
    </span>
  );
}

/** Away for the rest of today, until a time, or from a time. */
function AwayForm({
  name,
  onSend,
  onCancel,
}: {
  name: string;
  onSend: (a: Availability) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<Availability['mode']>('until');
  const [time, setTime] = useState('12:00');
  const timed = mode !== 'day';
  const validTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  const send = () => onSend(mode === 'day' ? { mode } : { mode, time });
  const choices: Array<[Availability['mode'], string]> = [
    ['day', 'Rest of today'],
    ['until', 'Out until'],
    ['from', 'Leaving at'],
  ];
  return (
    <span
      className="grid gap-1.5 rounded-md border bg-background/60 p-2"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <span className="text-[11.5px] font-medium">{name} is unavailable</span>
      <span role="radiogroup" aria-label="When" className="flex flex-wrap gap-1">
        {choices.map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={cn('rounded-md border px-1.5 py-0.5 text-[11px] hover:bg-accent', mode === m && 'border-primary bg-primary/10 text-foreground', FOCUS)}
          >
            {label}
          </button>
        ))}
      </span>
      <span className="flex items-center gap-1">
        {timed ? (
          <input
            type="time"
            step={900}
            value={time}
            onChange={(e) => setTime(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && validTime) send();
            }}
            aria-label={mode === 'until' ? 'Back at' : 'Leaving at'}
            className="rounded-md border bg-transparent px-1.5 py-0.5 font-mono text-[11px] outline-none focus:border-ring [color-scheme:dark]"
          />
        ) : (
          <span className="text-[11px] text-muted-foreground">Jobs not yet started move.</span>
        )}
        <button type="button" onClick={onCancel} className={cn('ml-auto rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground', FOCUS)}>
          Cancel
        </button>
        <button
          type="button"
          disabled={timed && !validTime}
          onClick={send}
          className={cn('rounded-md bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground disabled:opacity-40', FOCUS)}
        >
          Send
        </button>
      </span>
    </span>
  );
}

/** Hours that differ from a normal day: a late start or an early finish. */
export function shiftNote(shift: Shift | undefined): string | null {
  if (!shift) return null;
  const start = minutesOfDay(shift.clockInAt);
  const end = minutesOfDay(shift.clockOutAt);
  const parts: string[] = [];
  if (start !== null && start > NORMAL_START) parts.push(`In from ${clock(start)}`);
  if (end !== null) parts.push(`Leaves ${clock(end)}`);
  return parts.length ? parts.join(' · ') : null;
}

// The seeded day starts at 07:45; a clock-in after 09:00 is a late start worth showing.
const NORMAL_START = 9 * 60;

// Every row shares these columns: chevron or stop number, dot or pin, text,
// and count or time. The stops and the day bar sit in the same columns, so
// everything lines up down the list.
const ROW_GRID = 'grid grid-cols-[20px_12px_minmax(0,1fr)_auto] gap-x-2.5';
const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-ring/60';

// The day bar spans the company's working day (settings), an hour of slack before it.
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
  shift,
  startHour,
  endHour,
}: {
  stops: ScheduleSlot[];
  leaving: ScheduleSlot[];
  color: string;
  off: boolean;
  shift?: Shift;
  startHour: number;
  endHour: number;
}) {
  const away: Array<[number, number]> = [];
  const clockIn = minutesOfDay(shift?.clockInAt);
  const clockOut = minutesOfDay(shift?.clockOutAt);
  if (clockIn !== null && clockIn > NORMAL_START) away.push([startHour * 60, clockIn]);
  if (clockOut !== null) away.push([clockOut, endHour * 60]);
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
      {!off
        ? away.map(([a, b]) => (
            <span
              key={`away-${a}`}
              title="Not working"
              className="absolute inset-y-0 bg-[repeating-linear-gradient(135deg,rgb(245_158_11/0.16)_0_5px,transparent_5px_10px)]"
              style={{ left: x(a), width: w(a, b) }}
            />
          ))
        : null}
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
