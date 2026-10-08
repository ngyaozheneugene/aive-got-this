import { NextRequest, NextResponse } from 'next/server';
import { getCurrentBoard } from '../../../../dispatch/current-board';
import { getDatabase } from '../../../../db';
import { isIsoDate } from '../../../../shared/config/demo';
import { badRequest } from '../../_lib/http';
import { workspaceOf } from '../../_lib/workspace';

export const dynamic = 'force-dynamic';

/** The board for its own day, or for `?date=YYYY-MM-DD` to look ahead. */
export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get('date') ?? undefined;
  if (date !== undefined && !isIsoDate(date)) {
    return badRequest('invalid_date', { expected: 'YYYY-MM-DD' });
  }
  const board = await getCurrentBoard(getDatabase(workspaceOf(request)), date);
  return NextResponse.json(board);
}
