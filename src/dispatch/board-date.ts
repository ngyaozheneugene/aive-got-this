// Which day the board is. The seed records it on the v1 snapshot and every
// commit carries it forward (commit.ts writes `board.date`), so the latest
// snapshot answers it for either adapter without a separate setting.

import { EASTWIND_DATE, isIsoDate, singaporeToday } from '../shared/config/demo';
import type { IDatabase } from '../db/interface';

/** The board's "today": the day disruptions are planned and committed against. */
export async function boardDate(db: IDatabase, now: Date = new Date()): Promise<string> {
  const latest = await db.boardSnapshots.getLatest();
  const data = latest?.snapshotData as { date?: unknown; followsClock?: unknown } | undefined;
  // A company's own workspace is always today; the sample day stays on its day.
  if (data?.followsClock === true) return singaporeToday(now);
  return isIsoDate(data?.date) ? data.date : EASTWIND_DATE;
}

/** Whether the board's day follows the calendar. Commit carries it forward. */
export async function followsClock(db: IDatabase): Promise<boolean> {
  const latest = await db.boardSnapshots.getLatest();
  return (latest?.snapshotData as { followsClock?: unknown } | undefined)?.followsClock === true;
}
