// Which day the board is. The seed records it on the v1 snapshot and every
// commit carries it forward (commit.ts writes `board.date`), so the latest
// snapshot answers it for either adapter without a separate setting.

import { EASTWIND_DATE, isIsoDate } from '../shared/config/demo';
import type { IDatabase } from '../db/interface';

/** The board's "today": the day disruptions are planned and committed against. */
export async function boardDate(db: IDatabase): Promise<string> {
  const latest = await db.boardSnapshots.getLatest();
  const recorded = (latest?.snapshotData as { date?: unknown } | undefined)?.date;
  return isIsoDate(recorded) ? recorded : EASTWIND_DATE;
}
