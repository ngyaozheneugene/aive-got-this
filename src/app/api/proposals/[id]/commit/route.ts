import { NextRequest, NextResponse } from 'next/server';
import { proposalCommitBodySchema } from '../../../../../shared/contracts/tools';
import { commitPlan } from '../../../../../dispatch/commit';
import { getDatabase } from '../../../../../db';
import { badRequest, fail } from '../../../_lib/http';
import { workspaceOf } from '../../../_lib/workspace';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return badRequest('invalid_json');
  }

  // Only planId, sourceSnapshotId and actorId are read. Any other field the
  // caller sends is discarded here and never reaches the guard.
  const parsed = proposalCommitBodySchema.safeParse(json);
  if (!parsed.success) {
    return badRequest('invalid_commit', parsed.error.flatten());
  }

  const result = await commitPlan(getDatabase(workspaceOf(request)), {
    proposalId: id,
    planId: parsed.data.planId,
    sourceSnapshotId: parsed.data.sourceSnapshotId,
    actorId: parsed.data.actorId,
  });

  if (!result.ok) {
    return fail(result.code, result.httpStatus, result.detail);
  }

  return NextResponse.json({
    ok: true,
    snapshot: { id: result.snapshot.id, version: result.snapshot.version },
    proposal: result.proposal,
    applied: result.appliedSlots,
  });
}
