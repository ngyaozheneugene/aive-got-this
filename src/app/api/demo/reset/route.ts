import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../db';
import { boardDate } from '../../../../dispatch/board-date';
import { workspaceOf } from '../../_lib/workspace';

export const dynamic = 'force-dynamic';

/** Back to the seeded day: the finals board for today, or Eastwind under DEMO_SCENARIO=eastwind. */
export async function POST(request: Request) {
  // Only the sample day can be reset. The company's own workspace holds real
  // bookings, and a reset aimed at the wrong place once wiped a live board.
  const workspace = workspaceOf(request);
  if (workspace !== 'simulation') {
    return NextResponse.json(
      { error: 'reset_simulation_only', detail: 'Only the simulation can be reset. Send x-workspace: simulation.' },
      { status: 403 },
    );
  }
  const db = getDatabase(workspace);
  await db.reset();
  return NextResponse.json({ ok: true, date: await boardDate(db), version: await db.boardSnapshots.getLatestVersion() });
}
