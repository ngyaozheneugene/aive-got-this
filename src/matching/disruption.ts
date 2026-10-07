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
 * The board as it is once the event has happened. Returns a copy; events
 * other than an unavailability leave it as it was (an overrun is applied by
 * the engines, which own how far the knock-on goes).
 */
export function applyDisruption<S extends BoardSchedule>(schedule: S, event: OperationalEvent): S {
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
