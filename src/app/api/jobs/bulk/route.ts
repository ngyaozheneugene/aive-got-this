import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '../../../../db';
import { createJobsBulk } from '../../../../dispatch/create-job';
import { bulkCreateJobsBodySchema } from '../../../../shared/contracts/jobs';
import { badRequest, fail } from '../../_lib/http';
import { workspaceOf } from '../../_lib/workspace';

export const dynamic = 'force-dynamic';

/** Bulk-book jobs in a single atomic transaction. */
export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return badRequest('invalid_json');
  }

  const parsed = bulkCreateJobsBodySchema.safeParse(json);
  if (!parsed.success) {
    return badRequest('invalid_jobs_payload', parsed.error.flatten());
  }

  const result = await createJobsBulk(
    getDatabase(workspaceOf(request)),
    parsed.data.jobs,
  );

  if (!result.ok) {
    return fail(result.code, result.httpStatus, result.detail);
  }

  return NextResponse.json(
    { ok: true, created: result.created, jobs: result.jobs },
    { status: 201 },
  );
}
