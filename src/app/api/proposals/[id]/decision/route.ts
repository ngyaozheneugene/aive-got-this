import { NextRequest, NextResponse } from 'next/server';
import { proposalDecisionBodySchema } from '../../../../../shared/contracts/tools';
import { recordDecision } from '../../../../../dispatch/decision';
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

  const parsed = proposalDecisionBodySchema.safeParse(json);
  if (!parsed.success) {
    return badRequest('invalid_decision', parsed.error.flatten());
  }

  const result = await recordDecision(getDatabase(workspaceOf(request)), {
    proposalId: id,
    decision: parsed.data.decision,
    planId: parsed.data.planId,
    reason: parsed.data.reason,
    actorId: parsed.data.actorId,
  });

  if (!result.ok) {
    return fail(result.code, result.httpStatus, result.detail);
  }

  return NextResponse.json({ approval: result.approval, proposal: result.proposal });
}
