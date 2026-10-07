import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../db';
import { boardDate } from '../../../../dispatch/board-date';

export const dynamic = 'force-dynamic';

/** Back to the seeded day: the finals board for today, or Eastwind under DEMO_SCENARIO=eastwind. */
export async function POST() {
  const db = getDatabase();
  await db.reset();
  return NextResponse.json({ ok: true, date: await boardDate(db), version: await db.boardSnapshots.getLatestVersion() });
}
