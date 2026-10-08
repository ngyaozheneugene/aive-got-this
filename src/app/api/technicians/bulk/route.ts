import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '../../../../db';
import { createTechniciansBulk } from '../../../../dispatch/technicians';
import { bulkCreateTechniciansSchema } from '../../../../shared/contracts/technicians';
import { badRequest, fail } from '../../_lib/http';
import { workspaceOf } from '../../_lib/workspace';

export const dynamic = 'force-dynamic';

/** Bulk-add technicians in a single atomic transaction. */
export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return badRequest('invalid_json');
  }

  const parsed = bulkCreateTechniciansSchema.safeParse(json);
  if (!parsed.success) {
    return badRequest('invalid_technicians_payload', parsed.error.flatten());
  }

  const result = await createTechniciansBulk(
    getDatabase(workspaceOf(request)),
    parsed.data.technicians,
  );

  if (!result.ok) {
    return fail(result.code, result.httpStatus, result.detail);
  }

  return NextResponse.json(
    { ok: true, created: result.created, technicians: result.technicians },
    { status: 201 },
  );
}
