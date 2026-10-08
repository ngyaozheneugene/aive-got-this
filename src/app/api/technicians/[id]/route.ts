import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '../../../../db';
import { updateTechnician } from '../../../../dispatch/technicians';
import { updateTechnicianBodySchema } from '../../../../shared/contracts/technicians';
import { badRequest, fail } from '../../_lib/http';
import { workspaceOf } from '../../_lib/workspace';

export const dynamic = 'force-dynamic';

/** Edit a technician, or take them off the team with { isActive: false }. */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return badRequest('invalid_json');
  }
  const parsed = updateTechnicianBodySchema.safeParse(json);
  if (!parsed.success) return badRequest('invalid_technician', parsed.error.flatten());
  const result = await updateTechnician(getDatabase(workspaceOf(request)), id, parsed.data);
  if (!result.ok) return fail(result.code, result.httpStatus, result.detail);
  return NextResponse.json(result.technician);
}
