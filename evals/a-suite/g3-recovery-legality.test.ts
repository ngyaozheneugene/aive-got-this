/**
 * A-02 / A-03 / A-04 through the planning seam against the real scheduler.
 * Model is doubled; propose() and validatePlan() are not. Sidecar HTTP may
 * fall back to insertion when OPTIMIZER_URL is unreachable.
 */
import { describe, expect, it, vi } from 'vitest';
import { planUrgentEvent } from '../../src/dispatch/plan-event';
import { checkCommit } from '../../src/dispatch/commit-policy';
import { createUrgentTools } from '../../src/agent/tools/urgent';
import { setupAgent } from './fixtures';

async function planWithRealScheduler(
  db: Awaited<ReturnType<typeof setupAgent>>['db'],
  eventId: string,
  model: Awaited<ReturnType<typeof setupAgent>>['model'],
) {
  return planUrgentEvent(db, { eventId, profile: 'sla_first' }, { createModel: () => model });
}

describe('A-02 / A-03 / A-04 agent + real propose() (not fixture doubles)', () => {
  it('A-02: unavailable keeps the on-site job on Hafiz and moves the rest, without writing the board', async () => {
    const h = await setupAgent();
    const before = structuredClone(await h.db.assignments.listAll());
    const event = await h.db.events.create({
      type: 'technician_unavailable',
      rawText: 'Hafiz MC after the morning job',
      normalizedPayload: { technicianId: 'tech_hafiz' },
      sourceSnapshotId: h.snapshot.id,
      affectedIds: ['tech_hafiz'],
      validationIssues: [],
      status: 'RECEIVED',
    });

    const planned = await planWithRealScheduler(h.db, event.id, h.model);
    expect(planned.ok, planned.ok ? '' : planned.detail).toBe(true);
    if (!planned.ok) return;

    expect(planned.plans.length).toBeGreaterThan(0);
    for (const plan of planned.plans) {
      const inProgress = plan.assignments.find((slot) => slot.jobId === 'job_hafiz_1');
      expect(inProgress?.technicianId).toBe('tech_hafiz');
      for (const slot of plan.assignments.filter((row) => row.jobId === 'job_hafiz_2' || row.jobId === 'job_hafiz_3')) {
        expect(slot.technicianId).not.toBe('tech_hafiz');
      }
    }
    expect(await h.db.assignments.listAll()).toEqual(before);
    expect(await h.db.boardSnapshots.getLatest()).toEqual(h.snapshot);
  });

  it('A-03: 45-minute overrun keeps the frozen on-site job on Hafiz and extends its window', async () => {
    const h = await setupAgent();
    const before = structuredClone(await h.db.assignments.listAll());
    const original = before.find((row) => row.jobId === 'job_hafiz_1')!;
    const event = await h.db.events.create({
      type: 'job_overrun',
      rawText: 'job_hafiz_1 overrun 45 minutes',
      normalizedPayload: { jobId: 'job_hafiz_1', overrunMinutes: 45 },
      sourceSnapshotId: h.snapshot.id,
      affectedIds: ['job_hafiz_1'],
      validationIssues: [],
      status: 'RECEIVED',
    });

    const planned = await planWithRealScheduler(h.db, event.id, h.model);
    expect(planned.ok, planned.ok ? '' : planned.detail).toBe(true);
    if (!planned.ok) return;

    expect(planned.plans.length).toBeGreaterThan(0);
    for (const plan of planned.plans) {
      const overrun = plan.assignments.find((slot) => slot.jobId === 'job_hafiz_1');
      expect(overrun?.technicianId).toBe('tech_hafiz');
      expect(Date.parse(overrun?.windowEnd ?? '')).toBeGreaterThan(Date.parse(original.windowEnd ?? ''));
    }
    expect(await h.db.assignments.listAll()).toEqual(before);
    expect(await h.db.boardSnapshots.getLatest()).toEqual(h.snapshot);
  });

  it('A-04: a proven empty feasible set stores no proposal and has no commit path', async () => {
    const h = await setupAgent();
    vi.spyOn(h.db.technicians, 'getCerts').mockResolvedValue([]);
    const tools = createUrgentTools(h.db);
    expect((await tools.readContext(h.event.id)).schedule.certs).toEqual([]);

    const planned = await planWithRealScheduler(h.db, h.event.id, h.model);
    expect(planned.ok).toBe(false);
    if (planned.ok) return;
    expect(planned.httpStatus).toBe(409);
    expect(planned.code).toBe('no_candidate_plans');
    expect((await h.db.events.getById(h.event.id))?.status).toBe('INFEASIBLE');
    expect(await h.db.proposals.getByEventId(h.event.id)).toBeNull();
    expect(checkCommit({
      proposal: null, plan: null, approval: null,
      latestSnapshotId: h.snapshot.id, requestedSourceSnapshotId: h.snapshot.id,
    })).toMatchObject({ ok: false, code: 'proposal_not_found' });
    expect(await h.db.boardSnapshots.getLatest()).toEqual(h.snapshot);
  });
});
