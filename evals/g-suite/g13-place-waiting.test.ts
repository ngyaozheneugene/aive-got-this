/**
 * G-13: every waiting job placed in one plan (ADR 014), by the real solver.
 *
 *   RUN_SIDECAR_ACCEPTANCE=1 OPTIMIZER_URL=http://localhost:8081 npx vitest run evals/g-suite/g13-place-waiting.test.ts
 */
import { describe, expect, it, vi } from 'vitest';
import { InMemoryDatabase } from '../../src/db/memory';
import { buildBoardSchedule } from '../../src/dispatch/board-schedule';
import { createJob } from '../../src/dispatch/create-job';
import { createJobType } from '../../src/dispatch/settings';
import { proposeWithSidecar } from '../../src/matching/propose';
import { createJobBodySchema } from '../../src/shared/contracts/jobs';
import { buildScenario } from '../../src/shared/fixtures/scenario';
import type { PlanProfile } from '../../src/shared/types/domain';

const DATE = '2026-10-20';
const sidecar = process.env.RUN_SIDECAR_ACCEPTANCE === '1';
const PROFILES: PlanProfile[] = ['sla_first', 'minimal_disruption'];
vi.setConfig({ testTimeout: 60_000 });

// A morning's imports across the island, every job type, mixed priorities.
const IMPORTS = [
  ['307506', '10 Sinaran Dr', 'WATER_LEAK', 'urgent', '08:30', '11:30'],
  ['460218', 'Bedok North St 1', 'GAS_TOPUP', 'urgent', '14:00', '17:00'],
  ['520245', 'Tampines Street 21', 'GENERAL_SERVICE', 'on_demand', '10:00', '12:30'],
  ['150123', 'Bukit Merah View', 'GENERAL_SERVICE', 'urgent', '09:00', '12:00'],
  ['828288', 'Punggol Field', 'CHEMICAL_WASH', 'when_available', '14:00', '17:00'],
  ['650123', 'Bukit Batok West Ave 6', 'GENERAL_SERVICE', 'on_demand', '13:00', '17:00'],
  ['238859', 'Orchard Road', 'WATER_LEAK', 'on_demand', '11:00', '15:00'],
  ['730123', 'Woodlands Dr 14', 'INSTALLATION', 'when_available', '12:00', '18:00'],
] as const;

async function day(extra?: (db: InMemoryDatabase) => Promise<void>) {
  const db = new InMemoryDatabase({ scenario: () => buildScenario(DATE) });
  for (const [i, [postalCode, address, jobTypeId, priority, windowStart, windowEnd]] of IMPORTS.entries()) {
    const made = await createJob(db, createJobBodySchema.parse({
      customerName: `Import ${i}`, phone: `9${String(2000000 + i).padStart(7, '0')}`, postalCode, address, jobTypeId, priority, windowStart, windowEnd,
    }));
    if (!made.ok) throw new Error(made.detail);
  }
  await extra?.(db);
  const schedule = await buildBoardSchedule(db);
  const booked = new Set(schedule.assignments.map((a) => a.jobId));
  const jobIds = schedule.jobs.filter((j) => !booked.has(j.id)).map((j) => j.id);
  const event = await db.events.create({
    type: 'place_waiting', rawText: '', normalizedPayload: { jobIds }, sourceSnapshotId: schedule.snapshotId,
    affectedIds: jobIds, validationIssues: [], status: 'VALIDATED',
  });
  return { schedule, event, jobIds };
}

const of = (plan: { changeSet: Array<Record<string, unknown>> }, action: string) => plan.changeSet.filter((c) => c.action === action);

describe('G-13 place every waiting job', () => {
  it('places every waiting job that fits, legally and inside its window, on both profiles', async () => {
    const { schedule, event, jobIds } = await day();
    expect(jobIds).toHaveLength(9);
    // The 08:30 Novena leak needs a tier 2 technician, and every one is booked
    // all morning: around booked work there is no time for it. It stays
    // waiting, said so, rather than the plan moving booked customers.
    const novena = schedule.jobs.find((j) => j.windowStart?.endsWith('T08:30:00+08:00') && jobIds.includes(j.id))!.id;
    for (const profile of PROFILES) {
      const out = await proposeWithSidecar({ event, schedule, profile });
      if (sidecar) expect(out.engine, `the sidecar must answer: ${out.message ?? ''}`).toBe('ortools');
      const plan = out.plans.find((p) => p.profile === profile);
      expect(plan, `${profile}: ${out.message ?? 'no plan'}`).toBeDefined();
      expect(plan!.validations.violations, profile).toEqual([]);
      const placed = of(plan!, 'assign').map((c) => c.jobId);
      const left = of(plan!, 'leave_waiting');
      expect([...placed, ...left.map((c) => c.jobId)].sort(), profile).toEqual([...jobIds].sort());
      expect(left, `${profile} left waiting`).toEqual([{ action: 'leave_waiting', jobId: novena, reason: 'no_time' }]);
      expect(plan!.metrics.unassignedCount).toBe(1);
      for (const id of jobIds.filter((j) => j !== novena)) {
        const job = schedule.jobs.find((j) => j.id === id)!;
        const slot = plan!.assignments.find((a) => a.jobId === id)!;
        expect(Date.parse(slot.windowStart!)).toBeGreaterThanOrEqual(Date.parse(job.windowStart!));
        expect(Date.parse(slot.windowEnd!)).toBeLessThanOrEqual(Date.parse(job.windowEnd!));
      }
      // Nothing booked lost its technician: placing work never unbooks anyone.
      expect(of(plan!, 'unassign')).toEqual([]);
    }
  });

  it('leaves a job nobody may take waiting with its reason, and places the rest', async () => {
    let survey = '';
    const { schedule, event } = await day(async (db) => {
      const type = await createJobType(db, { name: 'Structural survey', minTier: 4, defaultMinutes: 60, certs: ['BCA_STRUCTURAL', 'EMA_LEW'] });
      if (!type.ok) throw new Error(type.detail);
      const made = await createJob(db, createJobBodySchema.parse({
        customerName: 'Tower', phone: '91119999', postalCode: '520123', address: 'Simei St 1', jobTypeId: type.jobType.id, priority: 'urgent', windowStart: '09:00', windowEnd: '17:00',
      }));
      if (!made.ok) throw new Error(made.detail);
      survey = made.job.id;
    });
    for (const profile of PROFILES) {
      const out = await proposeWithSidecar({ event, schedule, profile });
      if (sidecar) expect(out.engine).toBe('ortools');
      const plan = out.plans.find((p) => p.profile === profile)!;
      expect(plan.validations.violations).toEqual([]);
      expect(of(plan, 'leave_waiting')).toContainEqual({ action: 'leave_waiting', jobId: survey, reason: 'no_legal_technician' });
      expect(of(plan, 'leave_waiting')).toHaveLength(2); // the survey, and the Novena leak (no time)
      expect(of(plan, 'assign')).toHaveLength(8);
      expect(plan.metrics.unassignedCount).toBe(2);
    }
  });
});
