import { NextResponse } from 'next/server';
import { getCurrentBoard } from '../../../../dispatch/current-board';
import { getDatabase } from '../../../../db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const board = await getCurrentBoard(getDatabase());
  return NextResponse.json(board);
}
