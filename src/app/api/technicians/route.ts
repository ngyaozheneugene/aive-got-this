import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '../../../db';
import { createTechnician, listTeam } from '../../../dispatch/technicians';
import { createTechnicianBodySchema } from '../../../shared/contracts/technicians';
import { badRequest, fail } from '../_lib/http';
import { workspaceOf } from '../_lib/workspace';

export const dynamic = 'force-dynamic';

/** The team, with certificates, for team setup. */
export async function GET(request: Request) {
  return NextResponse.json(await listTeam(getDatabase(workspaceOf(request))));
}

/** Add a technician. They work every day from 08:00 unless their shift says otherwise. */
export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return badRequest('invalid_json');
  }
  const parsed = createTechnicianBodySchema.safeParse(json);
  if (!parsed.success) return badRequest('invalid_technician', parsed.error.flatten());
  const result = await createTechnician(getDatabase(workspaceOf(request)), parsed.data);
  if (!result.ok) return fail(result.code, result.httpStatus, result.detail);
  return NextResponse.json(result.technician, { status: 201 });
}
