import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '../../../db';
import { createJob } from '../../../dispatch/create-job';
import { createJobBodySchema } from '../../../shared/contracts/jobs';
import { badRequest, fail } from '../_lib/http';

export const dynamic = 'force-dynamic';

/** Book a new job. It lands unassigned; raise an urgent_job event to place it. */
export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return badRequest('invalid_json');
  }
  const parsed = createJobBodySchema.safeParse(json);
  if (!parsed.success) return badRequest('invalid_job', parsed.error.flatten());

  const result = await createJob(getDatabase(), parsed.data);
  if (!result.ok) return fail(result.code, result.httpStatus, result.detail);
  const { ok: _ok, ...created } = result;
  return NextResponse.json(created, { status: 201 });
}
