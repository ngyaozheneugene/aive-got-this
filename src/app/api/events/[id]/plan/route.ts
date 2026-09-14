import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '../../../../../db';
import { propose } from '../../../../../matching/propose';
import { planProfileSchema } from '../../../../../shared/contracts/propose';
import type { BoardSchedule, PlanProfile } from '../../../../../shared/types/domain';
import { badRequest, fail } from '../../../_lib/http';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;
  let json: Record<string, unknown> = {};

  try {
    const text = await request.text();
    if (text.trim()) {
      json = JSON.parse(text);
    }
  } catch {
    return badRequest('invalid_json');
  }

  let profile: PlanProfile = 'sla_first';
  if (json.profile) {
    const parsedProfile = planProfileSchema.safeParse(json.profile);
    if (!parsedProfile.success) {
      return badRequest('invalid_profile');
    }
    profile = parsedProfile.data;
  }

  const db = getDatabase();
  const event = await db.events.getById(eventId);
  if (!event) {
    return fail('event_not_found', 404);
  }

  const snapshotVersion = await db.boardSnapshots.getLatestVersion();
  const snapshot = await db.boardSnapshots.getSnapshot(snapshotVersion);

  const technicians = await db.technicians.listAll();
  const jobs = await db.jobs.listByScheduledDate(event.receivedAt.substring(0, 10));
  const assignments =
    (snapshot?.snapshotData?.assignments as BoardSchedule['assignments']) || [];
  const travel = (snapshot?.snapshotData?.travel as BoardSchedule['travel']) || [];

  const schedule: BoardSchedule = {
    date: event.receivedAt.substring(0, 10),
    snapshotId: snapshot?.id || 'snap_v1',
    snapshotVersion,
    technicians,
    jobs,
    assignments,
    travel,
  };

  const proposeOutput = propose({
    event,
    schedule,
    profile,
  });

  const proposal = await db.proposals.create({
    eventId: event.id,
    sourceSnapshotId: snapshot?.id || 'snap_v1',
    recommendedPlanId: proposeOutput.plans[0]?.id,
    risk: 'medium',
    autonomyMode: 'approval',
    status: 'RECOMMENDED',
  });

  const savedPlans = [];
  for (const plan of proposeOutput.plans) {
    const savedPlan = await db.candidatePlans.create({
      proposalId: proposal.id,
      sourceSnapshotId: snapshot?.id || 'snap_v1',
      profile: plan.profile,
      assignments: plan.assignments,
      changeSet: plan.changeSet,
      metrics: plan.metrics,
      validations: plan.validations,
      solverTrace: plan.solverTrace,
      timedOut: plan.timedOut,
      durationMs: plan.durationMs,
      status: plan.id === proposal.recommendedPlanId ? 'RECOMMENDED' : 'VALIDATED',
    });
    savedPlans.push(savedPlan);
  }

  await db.events.updateStatus(event.id, 'PROPOSAL_READY');

  return NextResponse.json(
    {
      proposal,
      plans: savedPlans,
      engine: proposeOutput.engine,
      timedOut: proposeOutput.timedOut,
    },
    { status: 201 },
  );
}
