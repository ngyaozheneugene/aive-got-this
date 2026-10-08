import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../../db';
import { workspaceOf } from '../../../_lib/workspace';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const db = getDatabase(workspaceOf(request));

  const event = await db.events.getById(id);
  if (!event) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const entries = await db.decisionLogs.listByEvent(id);
  return NextResponse.json({ eventId: id, status: event.status, entries });
}
