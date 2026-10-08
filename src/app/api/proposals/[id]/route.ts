import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../db';
import { workspaceOf } from '../../_lib/workspace';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const db = getDatabase(workspaceOf(request));
  const proposal = await db.proposals.getById(id);
  if (!proposal) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const plans = await db.candidatePlans.listByProposal(id);
  return NextResponse.json({ proposal, plans });
}
