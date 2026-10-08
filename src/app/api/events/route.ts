import { NextRequest, NextResponse } from 'next/server';
import { createEventBodySchema } from '../../../shared/contracts/events';
import { getDatabase } from '../../../db';
import { badRequest } from '../_lib/http';
import { workspaceOf } from '../_lib/workspace';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return badRequest('invalid_json');
  }

  const parsed = createEventBodySchema.safeParse(json);
  if (!parsed.success) {
    return badRequest('invalid_event', parsed.error.flatten());
  }

  const db = getDatabase(workspaceOf(request));
  const snapshot = await db.boardSnapshots.getLatest();
  const body = parsed.data;
  const affectedIds =
    body.type === 'technician_unavailable' ? [body.payload.technicianId] : [body.payload.jobId];

  const event = await db.events.create({
    type: body.type,
    rawText: body.rawText ?? '',
    normalizedPayload: body.payload,
    sourceSnapshotId: body.sourceSnapshotId ?? snapshot?.id,
    affectedIds,
    validationIssues: [],
    status: 'VALIDATED',
  });

  return NextResponse.json(event, { status: 201 });
}
