import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '../../../../db';
import { updateJobType } from '../../../../dispatch/settings';
import { updateJobTypeBodySchema } from '../../../../shared/contracts/settings';
import { badRequest, fail } from '../../_lib/http';
import { workspaceOf } from '../../_lib/workspace';

export const dynamic = 'force-dynamic';

/** Edit a job type. Applies to new bookings; booked jobs keep what they needed. */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return badRequest('invalid_json');
  }
  const parsed = updateJobTypeBodySchema.safeParse(json);
  if (!parsed.success) return badRequest('invalid_job_type', parsed.error.flatten());
  const result = await updateJobType(getDatabase(workspaceOf(request)), id, parsed.data);
  if (!result.ok) return fail(result.code, result.httpStatus, result.detail);
  return NextResponse.json(result.jobType);
}
