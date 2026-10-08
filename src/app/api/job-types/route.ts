import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '../../../db';
import { createJobType, listJobTypes } from '../../../dispatch/settings';
import { createJobTypeBodySchema } from '../../../shared/contracts/settings';
import { badRequest, fail } from '../_lib/http';
import { workspaceOf } from '../_lib/workspace';

export const dynamic = 'force-dynamic';

/** What can be booked, with the certificates each needs. */
export async function GET(request: Request) {
  return NextResponse.json(await listJobTypes(getDatabase(workspaceOf(request))));
}

/** Add a kind of job to the catalogue. ADR 011. */
export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return badRequest('invalid_json');
  }
  const parsed = createJobTypeBodySchema.safeParse(json);
  if (!parsed.success) return badRequest('invalid_job_type', parsed.error.flatten());
  const result = await createJobType(getDatabase(workspaceOf(request)), parsed.data);
  if (!result.ok) return fail(result.code, result.httpStatus, result.detail);
  return NextResponse.json(result.jobType, { status: 201 });
}
