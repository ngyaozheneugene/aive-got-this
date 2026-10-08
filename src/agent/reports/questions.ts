// Read-only answers for questions typed into the desk ("who's free at 3?",
// "why does Jonah have Raffles Place?"). Every fact here is computed by code
// from the board, the shifts and the same Stage A gate planning uses; the
// model only chooses which question to ask of it and words the answer. ADR 010.

import type { DeskBoard, DeskJobRow, Shift, TechnicianCert } from '../../shared/types/domain';
import type { PlanningSchedule } from '../../dispatch/board-schedule';
import { stageA } from '../../matching/gates/stage-a';

// Defaults when the schedule carries no working day (settings, ADR 011).
const DAY_START = 8 * 60;
const DAY_END = 18 * 60;

const minutes = (iso?: string) => {
  const m = /T(\d{2}):(\d{2})/.exec(iso ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

function shiftOf(schedule: PlanningSchedule, technicianId: string): Shift | undefined {
  return schedule.shifts.find((s) => s.technicianId === technicianId && s.shiftDate === schedule.date);
}

const dayStart = (schedule: PlanningSchedule) => (schedule.workingDay ? toMin(schedule.workingDay.start) : DAY_START);
const dayEnd = (schedule: PlanningSchedule) => (schedule.workingDay ? toMin(schedule.workingDay.end) : DAY_END);

/** Working hours for the day, or null when they are off. */
function hours(schedule: PlanningSchedule, shift: Shift | undefined): { from: number; to: number } | null {
  if (!shift || shift.status === 'mc' || shift.status === 'no_show') return null;
  const start = dayStart(schedule);
  return { from: Math.max(start, minutes(shift.clockInAt) ?? start), to: minutes(shift.clockOutAt) ?? dayEnd(schedule) };
}

function busy(board: DeskBoard, technicianId: string): Array<{ from: number; to: number; row: DeskJobRow }> {
  return board.jobs
    .filter((r) => r.assignment?.technicianId === technicianId)
    .map((r) => ({ from: minutes(r.assignment!.windowStart)!, to: minutes(r.assignment!.windowEnd)!, row: r }))
    .filter((b) => b.from !== null && b.to !== null)
    .sort((a, b) => a.from - b.from);
}

/** Free gaps in a technician's day, ignoring travel. */
function gaps(board: DeskBoard, schedule: PlanningSchedule, technicianId: string): Array<{ from: number; to: number }> {
  const h = hours(schedule, shiftOf(schedule, technicianId));
  if (!h) return [];
  const out: Array<{ from: number; to: number }> = [];
  let cursor = h.from;
  for (const b of busy(board, technicianId)) {
    if (b.from > cursor) out.push({ from: cursor, to: Math.min(b.from, h.to) });
    cursor = Math.max(cursor, b.to);
  }
  if (cursor < h.to) out.push({ from: cursor, to: h.to });
  return out.filter((g) => g.to > g.from);
}

/** Who is on shift and has nothing booked across [from, to]; qualified for the job type when one is given. */
export function whoIsFree(
  board: DeskBoard,
  schedule: PlanningSchedule,
  q: { from: string; to?: string; jobTypeId?: string },
  jobType?: { id: string; minTier: number; certs: string[] },
) {
  const from = toMin(q.from);
  const to = q.to ? toMin(q.to) : from + 60;
  const qualified = (technicianId: string) => {
    if (!jobType) return { ok: true as const };
    const probe = { id: '__probe', scheduledDate: schedule.date, partsRequired: [], toolsRequired: [] } as unknown as DeskJobRow['job'];
    const verdict = stageA(probe, schedule.technicians.filter((t) => t.id === technicianId), schedule.certs, schedule.shifts, [
      { id: 'r', jobId: '__probe', minTier: jobType.minTier as 1, requiredCerts: jobType.certs, requiredCrewSize: 1, createdAt: '' },
    ])[0];
    return verdict?.isEligible ? { ok: true as const } : { ok: false as const, why: verdict?.exclusionReasons ?? [] };
  };
  const free: Array<{ name: string; area?: string; freeFrom: string; freeUntil: string }> = [];
  const notQualified: Array<{ name: string; why: string[] }> = [];
  for (const t of board.technicians) {
    const gap = gaps(board, schedule, t.technician.id).find((g) => g.from <= from && g.to >= to);
    if (!gap) continue;
    const ok = qualified(t.technician.id);
    if (!ok.ok) {
      notQualified.push({ name: t.technician.name, why: ok.why });
      continue;
    }
    free.push({ name: t.technician.name, area: t.technician.currentCluster, freeFrom: clock(gap.from), freeUntil: clock(gap.to) });
  }
  return { window: `${clock(from)}-${clock(to)}`, jobType: jobType?.id ?? null, free, freeButNotQualified: notQualified, note: 'Free means nothing booked and on shift; drive time is not counted.' };
}

/** One technician's day: hours, stops, load and certificates. */
export function technicianDay(board: DeskBoard, schedule: PlanningSchedule, technicianId: string, certs: TechnicianCert[]) {
  const row = board.technicians.find((t) => t.technician.id === technicianId);
  if (!row) return { error: 'technician_not_on_board' };
  const h = hours(schedule, shiftOf(schedule, technicianId));
  return {
    name: row.technician.name,
    tier: row.technician.tier,
    area: row.technician.currentCluster,
    // No clock-out on file means no end was set, not that they finish at 18:00.
    working: !h ? 'not working today' : shiftOf(schedule, technicianId)?.clockOutAt ? `${clock(h.from)}-${clock(h.to)}` : `from ${clock(h.from)}, no finish time set`,
    bookedMinutes: row.loadMinutes,
    stops: busy(board, technicianId).map((b) => ({
      time: `${clock(b.from)}-${clock(b.to)}`,
      customer: b.row.customer.name,
      address: b.row.site.addressLine1,
      jobId: b.row.job.id,
    })),
    freeGaps: gaps(board, schedule, technicianId).map((g) => `${clock(g.from)}-${clock(g.to)}`),
    note: `Free gaps are counted to ${clock(dayEnd(schedule))} when no finish time is set; drive time is not counted.`,
    certificates: certs.map((c) => `${c.certType}${c.expiresAt ? ` (expires ${c.expiresAt})` : ''}`),
    parts: row.technician.parts ?? [],
  };
}

/** For a job: who has it, and for everyone else whether they could legally take it and whether they are busy then. */
export function whyTechnician(board: DeskBoard, schedule: PlanningSchedule, jobId: string) {
  const row = board.jobs.find((r) => r.job.id === jobId);
  if (!row) return { error: 'job_not_on_today_board' };
  const job = schedule.jobs.find((j) => j.id === jobId) ?? row.job;
  const requirement = schedule.jobRequirements.find((r) => r.jobId === jobId);
  const slotFrom = minutes(row.assignment?.windowStart ?? row.job.windowStart);
  const slotTo = minutes(row.assignment?.windowEnd ?? row.job.windowEnd);
  const verdicts = stageA(job, schedule.technicians, schedule.certs, schedule.shifts, schedule.jobRequirements);
  return {
    job: { customer: row.customer.name, address: row.site.addressLine1, area: row.site.estateCluster, time: slotFrom !== null && slotTo !== null ? `${clock(slotFrom)}-${clock(slotTo)}` : null },
    needs: { minTier: requirement?.minTier ?? null, certificates: requirement?.requiredCerts ?? [], parts: job.partsRequired ?? [] },
    assignedTo: row.technician?.name ?? null,
    others: verdicts
      .filter((v) => v.technician.id !== row.technician?.id)
      .map((v) => ({
        name: v.technician.name,
        area: v.technician.currentCluster,
        qualifies: v.isEligible,
        why: v.exclusionReasons,
        busyThen:
          slotFrom !== null && slotTo !== null
            ? busy(board, v.technician.id).some((b) => b.from < slotTo && slotFrom < b.to)
            : null,
      })),
    note: 'Who actually got it is decided by the solver from drive time, workload balance and disruption; these are the hard rules.',
  };
}

/** The day at a glance. */
export function boardSummary(board: DeskBoard, schedule: PlanningSchedule) {
  const away = board.technicians
    .map((t) => ({ name: t.technician.name, shift: shiftOf(schedule, t.technician.id) }))
    .filter((t) => t.shift && (t.shift.status === 'mc' || t.shift.clockOutAt || (minutes(t.shift.clockInAt) ?? 0) > dayStart(schedule) + 60))
    .map((t) => ({
      name: t.name,
      status: t.shift!.status === 'mc' ? 'off today' : [
        (minutes(t.shift!.clockInAt) ?? 0) > dayStart(schedule) + 60 ? `in from ${clock(minutes(t.shift!.clockInAt)!)}` : null,
        t.shift!.clockOutAt ? `leaves ${clock(minutes(t.shift!.clockOutAt)!)}` : null,
      ].filter(Boolean).join(', '),
    }));
  const load = [...board.technicians].sort((a, b) => b.loadMinutes - a.loadMinutes);
  return {
    day: board.date,
    onDuty: board.technicians.length,
    away,
    jobs: board.jobs.length,
    waiting: board.jobs.filter((r) => !r.assignment).map((r) => ({
      customer: r.customer.name,
      address: r.site.addressLine1,
      window: `${r.job.windowStart?.slice(11, 16)}-${r.job.windowEnd?.slice(11, 16)}`,
      priority: r.job.priority,
    })),
    busiest: load.slice(0, 3).map((t) => `${t.technician.name} ${t.loadMinutes} min`),
    quietest: load.slice(-3).reverse().map((t) => `${t.technician.name} ${t.loadMinutes} min`),
  };
}
