// Cancelling a job (ADR 015): the booking comes off the board, and waiting
// jobs may fill the freed time, placed around booked work that stays put.

import { describe, expect, it } from 'vitest';
import { InMemoryDatabase } from '../db/memory';
import type { IDatabase } from '../db/interface';
import { buildScenario } from '../shared/fixtures/scenario';
import { createEventBodySchema } from '../shared/contracts/events';
import { createJobBodySchema } from '../shared/contracts/jobs';
import { buildBoardSchedule } from './board-schedule';
import { commitPlan } from './commit';
import { createJob } from './create-job';
import { getCurrentBoard } from './current-board';
import { recordDecision } from './decision';
import { propose } from '../matching/propose';
import { createUrgentTools } from '../agent/tools/urgent';
import { AgentError } from '../agent/runtime/errors';
import { classifyProposalRisk } from '../agent/policy/risk';

const DATE = '2026-10-20';

/** The sample day, with an 08:30–11:30 leak in Novena nobody qualified has time for. */
async function day(withLeak = true) {
  const db = new InMemoryDatabase({ scenario: () => buildScenario(DATE) });
  let leak = '';
  if (withLeak) {
    const made = await createJob(db, createJobBodySchema.parse({
      customerName: 'Far East Medical', phone: '91882345', postalCode: '307506', address: '10 Sinaran Dr',
      jobTypeId: 'WATER_LEAK', priority: 'urgent', windowStart: '08:30', windowEnd: '11:30',
    }));
    if (!made.ok) throw new Error(made.detail);
    leak = made.job.id;
  }
  return { db, leak };
}

async function cancel(db: IDatabase, jobId: string) {
  const s = await buildBoardSchedule(db);
  const body = createEventBodySchema.parse({ type: 'job_cancelled', payload: { jobId, reason: 'customer_cancelled' } });
  const event = await db.events.create({
    type: body.type, rawText: '', normalizedPayload: body.payload, sourceSnapshotId: s.snapshotId,
    affectedIds: [jobId], validationIssues: [], status: 'VALIDATED',
  });
  return { event, schedule: s };
}

describe('job_cancelled: planning', () => {
  it('frees the time and fills it with a waiting job that now fits', async () => {
    const { db, leak } = await day();
    const { event, schedule } = await cancel(db, 'job_ben_1');
    const out = propose({ event, schedule, profile: 'sla_first' });
    for (const plan of out.plans) {
      expect(plan.validations).toEqual({ ok: true, violations: [] });
      expect(plan.changeSet[0]).toEqual({ action: 'cancel', jobId: 'job_ben_1', fromTechnicianId: 'tech_ben', reason: 'customer_cancelled' });
      expect(plan.assignments.some((s) => s.jobId === 'job_ben_1')).toBe(false);
    }
    const sla = out.plans.find((p) => p.profile === 'sla_first')!;
    expect(sla.changeSet).toContainEqual(expect.objectContaining({ action: 'assign', jobId: leak, technicianId: 'tech_ben' }));
  });

  it('just frees the time when nothing waiting can use it', async () => {
    const { db, leak } = await day();
    const { event, schedule } = await cancel(db, 'job_wei_1'); // Wei is tier 1; the leak needs tier 2
    const sla = propose({ event, schedule, profile: 'sla_first' }).plans.find((p) => p.profile === 'sla_first')!;
    expect(sla.changeSet).toContainEqual({ action: 'leave_waiting', jobId: leak, reason: 'no_time' });
    expect(sla.changeSet.filter((c) => c.action === 'assign' && c.jobId === leak)).toEqual([]);
    expect(sla.validations.ok).toBe(true);
  });

  it('is the cancellation alone when nothing else is waiting (cancelling a waiting job)', async () => {
    const { db } = await day(false);
    // Raffles Place is the day's only waiting job: cancelling it leaves nothing to place.
    const raffles = await cancel(db, 'job_raffles');
    const out = propose({ event: raffles.event, schedule: raffles.schedule, profile: 'sla_first' });
    expect(out.plans.map((p) => [p.profile, p.changeSet])).toEqual([
      ['sla_first', [{ action: 'cancel', jobId: 'job_raffles', fromTechnicianId: null, reason: 'customer_cancelled' }]],
      ['minimal_disruption', [{ action: 'cancel', jobId: 'job_raffles', fromTechnicianId: null, reason: 'customer_cancelled' }]],
    ]);
  });

  it('refuses to cancel work that has started', async () => {
    const { db } = await day(false);
    const { event } = await cancel(db, 'job_hafiz_1'); // on site since 08:00
    await expect(createUrgentTools(db).readContext(event.id)).rejects.toEqual(new AgentError('JOB_ALREADY_STARTED'));
  });

  it('always needs a person to approve', async () => {
    const { db } = await day();
    const { event, schedule } = await cancel(db, 'job_ben_1');
    const out = propose({ event, schedule, profile: 'sla_first' });
    const risk = classifyProposalRisk({ plans: out.plans, liveAssignments: schedule.assignments });
    expect(risk.reasons).toContain('cancellation');
    expect(risk.autonomyMode).toBe('approval');
  });
});

describe('job_cancelled: commit', () => {
  it('cancels the job, releases its booking, assigns the fill, and keeps the record', async () => {
    const { db, leak } = await day();
    const { event, schedule } = await cancel(db, 'job_ben_1');
    const [plan] = propose({ event, schedule, profile: 'sla_first' }).plans;
    const proposal = await db.proposals.create({ eventId: event.id, sourceSnapshotId: schedule.snapshotId, risk: 'medium', autonomyMode: 'approval', status: 'RECOMMENDED' });
    const saved = await db.candidatePlans.create({ ...plan!, proposalId: proposal.id, status: 'RECOMMENDED' });
    await db.proposals.updateStatus(proposal.id, 'RECOMMENDED', saved.id);
    expect((await recordDecision(db, { proposalId: proposal.id, decision: 'approved', reason: 'Customer called to cancel.', actorId: 'user_desk' })).ok).toBe(true);
    const committed = await commitPlan(db, { proposalId: proposal.id, planId: saved.id, sourceSnapshotId: schedule.snapshotId, actorId: 'user_desk' });
    expect(committed.ok).toBe(true);

    const board = await getCurrentBoard(db);
    expect(board.jobs.some((r) => r.job.id === 'job_ben_1')).toBe(false);
    expect(board.cancelled?.map((r) => [r.job.id, r.job.status])).toEqual([['job_ben_1', 'cancelled']]);
    expect((await db.assignments.getByJobId('job_ben_1')).every((a) => a.status !== 'accepted' && a.status !== 'offered')).toBe(true);
    const filled = board.jobs.find((r) => r.job.id === leak)!;
    expect([filled.technician?.id, filled.job.status]).toEqual(['tech_ben', 'assigned']);
    // Nothing plans around a cancelled job afterwards.
    expect((await buildBoardSchedule(db)).jobs.some((j) => j.id === 'job_ben_1')).toBe(false);
  });
});
