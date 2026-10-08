import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../db';
import { workspaceOf } from '../../_lib/workspace';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const event = await getDatabase(workspaceOf(request)).events.getById(id);
  if (!event) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json(event);
}
