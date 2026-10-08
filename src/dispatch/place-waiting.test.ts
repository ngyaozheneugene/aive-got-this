// Placing every waiting job in one plan (ADR 014): the event, the fallback
// planner, the agent's context check, and commit, on the finals sample day
// with five jobs booked on top of it.

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
import { createJobType } from './settings';
import { propose } from '../matching/propose';
import { createUrgentTools } from '../agent/tools/urgent';
import { AgentError } from '../agent/runtime/errors';

const DATE = '2026-10-20';
const BOOKINGS = [
  ['Far East Medical', '91882345', '307506', '10 Sinaran Dr', 'WATER_LEAK', 'urgent', '08:30', '11:30'],
  ['Uncle Teo', '82991122', '460218', 'Blk 218 Bedok North St 1', 'GAS_TOPUP', 'urgent', '14:00', '17:00'],
  ['Desmond Goh', '96554321', '520245', 'Tampines Street 21', 'GENERAL_SERVICE', 'on_demand', '10:00', '12:30'],
  ['Cold Storage', '97118899', '150123', 'Bukit Merah View', 'GENERAL_SERVICE', 'urgent', '09:00', '12:00'],
  ['Punggol Condo', '81223344', '828288', 'Punggol Field Blk 288', 'CHEMICAL_WASH', 'when_available', '14:00', '17:00'],
] as const;

async function dayWithWaiting(): Promise<IDatabase> {
  const db = new InMemoryDatabase({ scenario: () => buildScenario(DATE) });
  for (const [customerName, phone, postalCode, address, jobTypeId, priority, windowStart, windowEnd] of BOOKINGS) {
    const made = await createJob(db, createJobBodySchema.parse({ customerName, phone, postalCode, address, jobTypeId, priority, windowStart, windowEnd }));
    if (!made.ok) throw new Error(made.detail);
  }
  return db;
}

async function placeWaiting(db: IDatabase) {
  const board = await getCurrentBoard(db);
  const jobIds = board.jobs.filter((r) => !r.assignment).map((r) => r.job.id);
  const body = createEventBodySchema.parse({ type: 'place_waiting', payload: { jobIds }, sourceSnapshotId: board.snapshot.id });
  const event = await db.events.create({
    type: body.type, rawText: '', normalizedPayload: body.payload, sourceSnapshotId: board.snapshot.id,
    affectedIds: jobIds, validationIssues: [], status: 'VALIDATED',
  });
  return { event, jobIds };
}

const placedBy = (plan: { changeSet: Array<Record<string, unknown>> }, action: string) =>
  plan.changeSet.filter((c) => c.action === action).map((c) => c.jobId as string);

describe('place_waiting: the event', () => {
  it('takes a list of waiting jobs, each once', () => {
    expect(createEventBodySchema.safeParse({ type: 'place_waiting', payload: { jobIds: ['a', 'b'] } }).success).toBe(true);
    expect(createEventBodySchema.safeParse({ type: 'place_waiting', payload: { jobIds: [] } }).success).toBe(false);
    expect(createEventBodySchema.safeParse({ type: 'place_waiting', payload: { jobIds: ['a', 'a'] } }).success).toBe(false);
  });
});

describe('place_waiting: the fallback planner', () => {
  it('places every waiting job it legally can in one plan, both profiles valid', async () => {
    const db = await dayWithWaiting();
    const { event, jobIds } = await placeWaiting(db);
    expect(jobIds).toHaveLength(6); // Raffles Place plus the five bookings
    const out = propose({ event, schedule: await buildBoardSchedule(db), profile: 'sla_first' });
    expect(out.plans.map((p) => p.profile).sort()).toEqual(['minimal_disruption', 'sla_first']);
    for (const plan of out.plans) {
      expect(plan.validations).toEqual({ ok: true, violations: [] });
      const placed = placedBy(plan, 'assign');
      const left = placedBy(plan, 'leave_waiting');
      expect([...placed, ...left].sort()).toEqual([...jobIds].sort());
      expect(placed.length).toBeGreaterThanOrEqual(5);
      expect(plan.metrics.unassignedCount).toBe(left.length);
    }
  });

  it('leaves a job nobody is qualified for waiting, with the reason, and still places the rest', async () => {
    const db = await dayWithWaiting();
    const type = await createJobType(db, { name: 'Structural survey', minTier: 4, defaultMinutes: 60, certs: ['BCA_STRUCTURAL', 'EMA_LEW'] });
    if (!type.ok) throw new Error(type.detail);
    const made = await createJob(db, createJobBodySchema.parse({
      customerName: 'Tower Block', phone: '91110000', postalCode: '520123', address: 'Simei St 1', jobTypeId: type.jobType.id,
      priority: 'urgent', windowStart: '09:00', windowEnd: '17:00',
    }));
    if (!made.ok) throw new Error(made.detail);
    const { event } = await placeWaiting(db);
    const [plan] = propose({ event, schedule: await buildBoardSchedule(db), profile: 'sla_first' }).plans;
    expect(plan!.changeSet).toContainEqual({ action: 'leave_waiting', jobId: made.job.id, reason: 'no_legal_technician' });
    expect(placedBy(plan!, 'assign').length).toBeGreaterThanOrEqual(5);
    expect(plan!.validations.ok).toBe(true);
  });
});

describe('place_waiting: the agent and commit', () => {
  it('refuses a request when a listed job was placed in the meantime', async () => {
    const db = await dayWithWaiting();
    const { event, jobIds } = await placeWaiting(db);
    const tools = createUrgentTools(db);
    await expect(tools.readContext(event.id)).resolves.toBeTruthy();
    await db.assignments.createCommitted({
      jobId: jobIds[0]!, technicianId: 'tech_siti', snapshotId: event.sourceSnapshotId!,
      windowStart: `${DATE}T15:00:00+08:00`, windowEnd: `${DATE}T16:30:00+08:00`, metrics: {} as never,
    });
    await expect(tools.readContext(event.id)).rejects.toEqual(new AgentError('PLANNING_CONTEXT_CHANGED'));
  });

  it('commits the plan: placed jobs are assigned, the rest still wait', async () => {
    const db = await dayWithWaiting();
    const { event } = await placeWaiting(db);
    const schedule = await buildBoardSchedule(db);
    const [plan] = propose({ event, schedule, profile: 'sla_first' }).plans;
    const proposal = await db.proposals.create({ eventId: event.id, sourceSnapshotId: schedule.snapshotId, risk: 'medium', autonomyMode: 'approval', status: 'RECOMMENDED' });
    const saved = await db.candidatePlans.create({ ...plan!, proposalId: proposal.id, status: 'RECOMMENDED' });
    await db.proposals.updateStatus(proposal.id, 'RECOMMENDED', saved.id);
    expect((await recordDecision(db, { proposalId: proposal.id, decision: 'approved', reason: 'Place them all.', actorId: 'user_desk' })).ok).toBe(true);
    const committed = await commitPlan(db, { proposalId: proposal.id, planId: saved.id, sourceSnapshotId: schedule.snapshotId, actorId: 'user_desk' });
    expect(committed.ok).toBe(true);

    const board = await getCurrentBoard(db);
    for (const id of placedBy(plan!, 'assign')) {
      const row = board.jobs.find((r) => r.job.id === id)!;
      expect(row.assignment).toBeDefined();
      expect(row.job.status).toBe('assigned');
    }
    for (const id of placedBy(plan!, 'leave_waiting')) expect(board.jobs.find((r) => r.job.id === id)!.assignment).toBeUndefined();
  });
});
