/**
 * G-14: a cancellation frees time, and the real solver fills it with a waiting
 * job that now fits (ADR 015).
 *
 *   RUN_SIDECAR_ACCEPTANCE=1 OPTIMIZER_URL=http://localhost:8081 npx vitest run evals/g-suite/g14-cancel-job.test.ts
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
vi.setConfig({ testTimeout: 60_000 });

describe('G-14 cancel a job', () => {
  it('fills the freed morning with the waiting leak, legally, on both profiles', async () => {
    const db = new InMemoryDatabase({ scenario: () => buildScenario(DATE) });
    const leak = await createJob(db, createJobBodySchema.parse({
      customerName: 'Far East Medical', phone: '91882345', postalCode: '307506', address: '10 Sinaran Dr',
      jobTypeId: 'WATER_LEAK', priority: 'urgent', windowStart: '08:30', windowEnd: '11:30',
    }));
    if (!leak.ok) throw new Error(leak.detail);
    const schedule = await buildBoardSchedule(db);
    const event = await db.events.create({
      type: 'job_cancelled', rawText: '', normalizedPayload: { jobId: 'job_ben_1', reason: 'customer_cancelled' },
      sourceSnapshotId: schedule.snapshotId, affectedIds: ['job_ben_1'], validationIssues: [], status: 'VALIDATED',
    });
    for (const profile of ['sla_first', 'minimal_disruption'] as PlanProfile[]) {
      const out = await proposeWithSidecar({ event, schedule, profile });
      if (sidecar) expect(out.engine, out.message ?? '').toBe('ortools');
      const plan = out.plans.find((p) => p.profile === profile)!;
      expect(plan.validations.violations, profile).toEqual([]);
      expect(plan.changeSet[0]).toMatchObject({ action: 'cancel', jobId: 'job_ben_1', fromTechnicianId: 'tech_ben' });
      expect(plan.assignments.some((s) => s.jobId === 'job_ben_1')).toBe(false);
      const slot = plan.assignments.find((s) => s.jobId === leak.job.id);
      expect(slot, `${profile}: the leak is placed`).toBeDefined();
      expect(slot!.windowStart! >= `${DATE}T08:30`).toBe(true);
      expect(plan.changeSet.filter((c) => c.action === 'unassign' || c.action === 'reassign')).toEqual([]);
    }
  });
});
