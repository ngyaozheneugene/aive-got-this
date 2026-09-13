import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../db';

export const dynamic = 'force-dynamic';

export async function POST() {
  const db = getDatabase();
  await db.reset();
  return NextResponse.json({ ok: true, fixture: 'eastwind-tuesday' });
}
