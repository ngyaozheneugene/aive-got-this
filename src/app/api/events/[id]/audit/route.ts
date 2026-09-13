import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../../db';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const event = await getDatabase().events.getById(id);
  if (!event) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ eventId: id, entries: [] });
}
