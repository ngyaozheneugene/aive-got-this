// Lays the stored board, and optionally one candidate plan on top of it, out
// as timeline slots. Pure: it compares what the backend already stored and
// computes no scores. A plan may list the whole board (overrun, unavailable) or
// only the slots it touches (urgent); a job it does not list is unchanged.
import type { CandidatePlan, DeskBoard, DeskJobRow } from '../../shared/types/domain';
import { minutesOfDay } from './geo';

export type SlotChange = 'unchanged' | 'added' | 'reassigned' | 'retimed';

export interface ScheduleSlot {
  jobId: string;
  technicianId: string;
  start: number;
  end: number;
  travelBeforeMinutes?: number;
  row: DeskJobRow;
  change: SlotChange;
  /** Where the job sat on the board before the plan, when the plan moved it. */
  previous?: { technicianId: string; start: number; end: number };
}

export interface ScheduleView {
  slots: ScheduleSlot[];
  /** Jobs with no slot on the board or in the plan. */
  unassigned: DeskJobRow[];
  /** Visible hour range, whole hours. */
  startHour: number;
  endHour: number;
}

export function buildScheduleView(board: DeskBoard, plan?: CandidatePlan): ScheduleView {
  const rowByJob = new Map(board.jobs.map((r) => [r.job.id, r]));
  const base = new Map<string, ScheduleSlot>();

  for (const row of board.jobs) {
    const a = row.assignment;
    const start = minutesOfDay(a?.windowStart);
    const end = minutesOfDay(a?.windowEnd);
    if (!a || start === null || end === null) continue;
    base.set(row.job.id, {
      jobId: row.job.id,
      technicianId: a.technicianId,
      start,
      end,
      travelBeforeMinutes: a.travelBeforeMinutes,
      row,
      change: 'unchanged',
    });
  }

  const slots = new Map(base);
  for (const p of plan?.assignments ?? []) {
    const row = rowByJob.get(p.jobId);
    const start = minutesOfDay(p.windowStart);
    const end = minutesOfDay(p.windowEnd);
    if (!row || start === null || end === null) continue;
    const before = base.get(p.jobId);
    let change: SlotChange = 'unchanged';
    if (!before) change = 'added';
    else if (before.technicianId !== p.technicianId) change = 'reassigned';
    else if (before.start !== start || before.end !== end) change = 'retimed';
    slots.set(p.jobId, {
      jobId: p.jobId,
      technicianId: p.technicianId,
      start,
      end,
      travelBeforeMinutes: p.travelBeforeMinutes,
      row,
      change,
      previous:
        before && change !== 'unchanged'
          ? { technicianId: before.technicianId, start: before.start, end: before.end }
          : undefined,
    });
  }

  const all = [...slots.values()].sort((a, b) => a.start - b.start);
  const unassigned = board.jobs.filter((r) => !slots.has(r.job.id));

  let lo = 8 * 60;
  let hi = 18 * 60;
  for (const s of all) {
    lo = Math.min(lo, s.start - (s.travelBeforeMinutes ?? 0), s.previous?.start ?? lo);
    hi = Math.max(hi, s.end, s.previous?.end ?? hi);
  }

  return {
    slots: all,
    unassigned,
    startHour: Math.floor(lo / 60),
    endHour: Math.ceil(hi / 60),
  };
}
