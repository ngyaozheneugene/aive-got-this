import { describe, expect, it } from 'vitest';
import type { CandidatePlan, DeskBoard, DeskJobRow } from '../../shared/types/domain';
import { SITE_COORDS, minutesOfDay } from './geo';
import { buildScheduleView } from './schedule-view';
import { EASTWIND } from '../../shared/fixtures/eastwind';

const T = (hh: number, mm = 0) =>
  `2026-09-15T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+08:00`;

function row(jobId: string, techId?: string, start?: string, end?: string): DeskJobRow {
  return {
    job: { id: jobId, priority: 'normal' },
    customer: { name: jobId },
    site: { postalCode: '048616', addressLine1: '' },
    assignment: techId ? { technicianId: techId, windowStart: start, windowEnd: end, travelBeforeMinutes: 8 } : undefined,
  } as unknown as DeskJobRow;
}

function board(rows: DeskJobRow[]): DeskBoard {
  return { date: '2026-09-15', snapshot: { version: 1 }, technicians: [], jobs: rows } as unknown as DeskBoard;
}

function plan(assignments: CandidatePlan['assignments']): CandidatePlan {
  return { assignments } as CandidatePlan;
}

describe('minutesOfDay', () => {
  it('reads the wall clock in the string, not the viewer timezone', () => {
    expect(minutesOfDay('2026-09-15T13:30:00+08:00')).toBe(13 * 60 + 30);
    expect(minutesOfDay(undefined)).toBeNull();
  });
});

describe('buildScheduleView', () => {
  const base = board([
    row('a', 'tech_1', T(8), T(10)),
    row('b', 'tech_1', T(11), T(12, 30)),
    row('urgent'),
  ]);

  it('lays out the committed board with the open job unassigned', () => {
    const v = buildScheduleView(base);
    expect(v.slots.map((s) => [s.jobId, s.change])).toEqual([['a', 'unchanged'], ['b', 'unchanged']]);
    expect(v.unassigned.map((r) => r.job.id)).toEqual(['urgent']);
    expect([v.startHour, v.endHour]).toEqual([7, 18]);
  });

  it('marks an insertion as added and keeps unlisted jobs unchanged', () => {
    const v = buildScheduleView(base, plan([{ jobId: 'urgent', technicianId: 'tech_2', windowStart: T(13), windowEnd: T(14, 30) }]));
    expect(v.unassigned).toEqual([]);
    expect(v.slots.find((s) => s.jobId === 'urgent')).toMatchObject({ change: 'added', technicianId: 'tech_2', start: 780 });
    expect(v.slots.find((s) => s.jobId === 'a')?.change).toBe('unchanged');
  });

  it('keeps where a retimed job was, for the ghost', () => {
    const v = buildScheduleView(
      base,
      plan([
        { jobId: 'a', technicianId: 'tech_1', windowStart: T(8), windowEnd: T(11, 30) },
        { jobId: 'b', technicianId: 'tech_1', windowStart: T(11, 30), windowEnd: T(13) },
      ]),
    );
    expect(v.slots.find((s) => s.jobId === 'b')).toMatchObject({
      change: 'retimed',
      previous: { technicianId: 'tech_1', start: 660, end: 750 },
    });
  });

  it('marks a job moved to another technician as reassigned', () => {
    const v = buildScheduleView(base, plan([{ jobId: 'b', technicianId: 'tech_3', windowStart: T(11), windowEnd: T(12, 30) }]));
    expect(v.slots.find((s) => s.jobId === 'b')).toMatchObject({ change: 'reassigned', previous: { technicianId: 'tech_1' } });
  });

  it('widens the hour range when a plan runs late', () => {
    const v = buildScheduleView(base, plan([{ jobId: 'b', technicianId: 'tech_1', windowStart: T(18), windowEnd: T(19, 15) }]));
    expect(v.endHour).toBe(20);
  });
});

describe('SITE_COORDS', () => {
  it('has a pin for every Eastwind site', () => {
    const missing = EASTWIND.sites.filter((s) => !SITE_COORDS[s.postalCode]).map((s) => s.postalCode);
    expect(missing).toEqual([]);
  });
});
