// A technician added through setup works every day by default. Rather than
// writing a shift row for every future day, the board fills in a standard
// shift for any active technician without one on that day. A stored shift (a
// sick day, a late start, the seeded clock-ins) always wins.

import type { Shift, Technician } from '../shared/types/domain';

export const DEFAULT_CLOCK_IN = '08:00';

export function withDefaultShifts(shifts: Shift[], technicians: Technician[], date: string): Shift[] {
  const have = new Set(shifts.filter((s) => s.shiftDate === date).map((s) => s.technicianId));
  const filled = technicians
    .filter((t) => t.isActive && !have.has(t.id))
    .map<Shift>((t) => ({
      id: `shift_default_${t.id}_${date}`,
      technicianId: t.id,
      shiftDate: date,
      status: 'scheduled',
      clockInAt: `${date}T${DEFAULT_CLOCK_IN}:00+08:00`,
      createdAt: `${date}T00:00:00+08:00`,
    }));
  return [...shifts, ...filled];
}
