/**
 * G-11: a job booked from the desk plans like any waiting job.
 *
 *   RUN_SIDECAR_ACCEPTANCE=1 OPTIMIZER_URL=http://localhost:8081 npx vitest run evals/g-suite/g11-new-job.test.ts
 */
import { describe, expect, it, vi } from 'vitest';
import { InMemoryDatabase } from '../../src/db/memory';
import { buildBoardSchedule } from '../../src/dispatch/board-schedule';
import { createJob } from '../../src/dispatch/create-job';
import { proposeWithSidecar } from '../../src/matching/propose';
import { createJobBodySchema } from '../../src/shared/contracts/jobs';
import { buildScenario } from '../../src/shared/fixtures/scenario';
import type { PlanProfile } from '../../src/shared/types/domain';

const DATE = '2026-10-20';
const sidecar = process.env.RUN_SIDECAR_ACCEPTANCE === '1';
const PROFILES: PlanProfile[] = ['sla_first', 'minimal_disruption'];

vi.setConfig({ testTimeout: 30_000 });

const calls = [
  // A new customer anywhere on the island, each job type that gates on something.
  { postalCode: '529536', address: 'Tampines Street 81', jobTypeId: 'WATER_LEAK', windowStart: '13:00', windowEnd: '17:00' },
  { postalCode: '238859', address: 'Orchard Road', jobTypeId: 'GAS_TOPUP', windowStart: '14:00', windowEnd: '18:00' },
  { postalCode: '650123', address: 'Bukit Batok West Ave 6', jobTypeId: 'GENERAL_SERVICE', windowStart: '09:00', windowEnd: '12:00' },
  { postalCode: '828761', address: 'Punggol Drive', jobTypeId: 'INSTALLATION', windowStart: '12:00', windowEnd: '18:00' },
];

describe('G-11 booked jobs', () => {
  for (const [i, call] of calls.entries()) {
    it(`plans a booked ${call.jobTypeId} at ${call.postalCode} legally on both profiles`, async () => {
      const db = new InMemoryDatabase({ scenario: () => buildScenario(DATE) });
      const booked = await createJob(db, createJobBodySchema.parse({
        customerName: `Caller ${i}`, phone: `9${String(1000000 + i).padStart(7, '0')}`, priority: 'urgent', ...call,
      }));
      if (!booked.ok) throw new Error(booked.detail);
      const schedule = await buildBoardSchedule(db);
      const event = await db.events.create({
        type: 'urgent_job', rawText: '', normalizedPayload: { jobId: booked.job.id }, sourceSnapshotId: schedule.snapshotId,
        affectedIds: [booked.job.id], validationIssues: [], status: 'VALIDATED',
      });
      for (const profile of PROFILES) {
        const out = await proposeWithSidecar({ event, schedule, profile });
        if (sidecar) expect(out.engine, 'the sidecar must answer').toBe('ortools');
        const plan = out.plans.find((p) => p.profile === profile);
        expect(plan, `${profile}: ${out.message ?? 'no plan'}`).toBeDefined();
        expect(plan!.validations.violations, profile).toEqual([]);
        const slot = plan!.assignments.find((a) => a.jobId === booked.job.id)!;
        expect(Date.parse(slot.windowStart!)).toBeGreaterThanOrEqual(Date.parse(booked.job.windowStart!));
        expect(Date.parse(slot.windowEnd!)).toBeLessThanOrEqual(Date.parse(booked.job.windowEnd!));
      }
    });
  }
});
