// What a disruption does to the day, before anyone plans around it.
//
// A technician being unavailable is a change to their shift, nothing more:
//   all day        -> the shift is 'mc' (Stage A excludes them, the validator
//                     refuses their unstarted work)
//   until 14:00    -> they clock in at 14:00
//   from 15:00     -> they clock out at 15:00
// Planning applies it to its copy of the board, so both engines and the
// independent validator see the same day. Commit applies it to the stored
// shift, so the next event plans around it too.

import type { BoardSchedule, OperationalEvent, Shift } from '../shared/types/domain';
import {
  technicianUnavailablePayloadSchema,
  type TechnicianUnavailablePayload,
} from '../shared/contracts/events';

export interface ShiftPatch {
  status?: Shift['status'];
  clockInAt?: string;
  clockOutAt?: string;
}

const later = (a: string | undefined, b: string) => (!a || Date.parse(b) > Date.parse(a) ? b : a);
const earlier = (a: string | undefined, b: string) => (!a || Date.parse(b) < Date.parse(a) ? b : a);

/** The shift change an unavailability makes, given the shift as it stands. */
export function unavailabilityPatch(shift: Shift | undefined, payload: TechnicianUnavailablePayload): ShiftPatch {
  if (!payload.from && !payload.until) return { status: 'mc' };
  const patch: ShiftPatch = {};
  if (payload.until) patch.clockInAt = later(shift?.clockInAt, payload.until);
  if (payload.from) patch.clockOutAt = earlier(shift?.clockOutAt, payload.from);
  return patch;
}

/** Whether the payload's times fall on the board day. */
export function unavailabilityOnDay(payload: TechnicianUnavailablePayload, date: string): boolean {
  const day = (iso?: string) => !iso || iso.slice(0, 10) === date;
  return day(payload.from) && day(payload.until);
}

export function parseUnavailability(event: OperationalEvent): TechnicianUnavailablePayload | null {
  if (event.type !== 'technician_unavailable') return null;
  const parsed = technicianUnavailablePayloadSchema.safeParse(event.normalizedPayload);
  return parsed.success ? parsed.data : null;
}

/**
 * The board as it is once the event has happened. Returns a copy. An
 * unavailability cuts the shift; an overrun marks its job as under way (how
 * far it runs on, and the knock-on, stay with the engines).
 */
export function applyDisruption<S extends BoardSchedule>(schedule: S, event: OperationalEvent): S {
  // A cancelled job leaves the board with its booking; what remains is planned
  // as if it was never there (ADR 015).
  const cancelledJobId = event.type === 'job_cancelled' ? (event.normalizedPayload?.jobId as string | undefined) : undefined;
  if (cancelledJobId) {
    const extra = schedule as S & { jobRequirements?: Array<{ jobId: string }> };
    return {
      ...schedule,
      jobs: (schedule.jobs ?? []).filter((j) => j.id !== cancelledJobId),
      assignments: (schedule.assignments ?? []).filter((a) => a.jobId !== cancelledJobId),
      ...(extra.jobRequirements ? { jobRequirements: extra.jobRequirements.filter((r) => r.jobId !== cancelledJobId) } : {}),
    };
  }
  // A job reported running late has, by definition, started: it is the
  // technician's to finish, and may run past its window. Without this only a
  // job seeded as on site could overrun legally.
  const overrunJobId = event.type === 'job_overrun' ? (event.normalizedPayload?.jobId as string | undefined) : undefined;
  if (overrunJobId) {
    return {
      ...schedule,
      jobs: (schedule.jobs ?? []).map((j) => (j.id === overrunJobId && j.status !== 'on_site' ? { ...j, status: 'on_site' as const } : j)),
    };
  }
  const payload = parseUnavailability(event);
  if (!payload || !schedule.shifts) return schedule;
  const shifts = schedule.shifts.map((s) =>
    s.technicianId === payload.technicianId && s.shiftDate === schedule.date
      ? { ...s, ...unavailabilityPatch(s, payload) }
      : s,
  );
  return { ...schedule, shifts };
}

/** Whether `shift` lets the technician work [start, end). Started work is always theirs to finish. */
export function withinShift(shift: Shift | undefined, start: string, end: string): boolean {
  if (!shift || shift.status === 'mc' || shift.status === 'no_show') return false;
  if (shift.clockInAt && Date.parse(start) < Date.parse(shift.clockInAt)) return false;
  if (shift.clockOutAt && Date.parse(end) > Date.parse(shift.clockOutAt)) return false;
  return true;
}
