// Canonical Eastwind Tuesday. Imports nothing.

export const EASTWIND_DATE = '2026-09-15';
export const EASTWIND_TZ = '+08:00';
export const SNAPSHOT_V1_ID = 'snap_eastwind_v1';

/** Which seed the live desk runs on. `eastwind` is the 12-job test fixture. */
export type ScenarioName = 'eastwind' | 'finals';

const SG_OFFSET_MS = 8 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** The calendar date in Singapore at `now`, as YYYY-MM-DD. */
export function singaporeToday(now: Date = new Date()): string {
  return new Date(now.getTime() + SG_OFFSET_MS).toISOString().slice(0, 10);
}

/** `date` moved by whole days, as YYYY-MM-DD. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
