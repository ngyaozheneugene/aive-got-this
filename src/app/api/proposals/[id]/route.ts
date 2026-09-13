import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../db';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const db = getDatabase();
  const proposal = await db.proposals.getById(id);
  if (!proposal) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const plans = await db.candidatePlans.listByProposal(id);
  return NextResponse.json({ proposal, plans });
}
