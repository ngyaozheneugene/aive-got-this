import { NextResponse } from 'next/server';
import { getDatabase } from '../../../db';
import { workspaceOf } from '../_lib/workspace';

export const dynamic = 'force-dynamic';

/** What can be booked, for the desk's new-job form. */
export async function GET(request: Request) {
  const db = getDatabase(workspaceOf(request));
  const types = await db.jobTypes.listAll();
  const withCerts = await Promise.all(
    types.map(async (t) => ({ ...t, certs: (await db.jobTypes.getCerts(t.id)).map((c) => c.certType) })),
  );
  return NextResponse.json(withCerts);
}
