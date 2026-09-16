import { describe, expect, it, vi } from 'vitest';
import { runUrgentJobAgent } from '../../src/agent/runtime/urgent-graph';
import { createUrgentTools } from '../../src/agent/tools/urgent';
import { permittedCalls, setupAgent } from './fixtures';

describe('A-01 G1 urgent path (contract doubles, not scheduler acceptance)', () => {
  it('retrieves, proposes both profiles, validates each and preserves backend metrics without writing', async () => {
    const h = await setupAgent();
    const before = structuredClone(await h.db.assignments.listAll());
    const result = await runUrgentJobAgent({ eventId: h.event.id, tools: h.tools, model: h.model });
    expect(result.status).toBe('candidates_ready');
    expect(result.comparisonReady).toBe(true);
    expect(result.plans).toHaveLength(2);
    expect(result.modelCalls).toBe(5);
    expect(result.trace.map((step) => step.tool)).toEqual(['retrieve_board', 'propose', 'propose', 'validate', 'validate']);
    expect(h.scheduler.propose.mock.calls.map(([input]) => input.profile)).toEqual(['sla_first', 'minimal_disruption']);
    expect(h.scheduler.validate).toHaveBeenCalledTimes(2);
    expect(result.plans.map((plan) => plan.metrics.travelMinutes)).toEqual([34, 46]);
    expect(await h.db.assignments.listAll()).toEqual(before);
    expect(await h.db.boardSnapshots.getLatest()).toEqual(h.snapshot);
    expect(await h.db.proposals.getByEventId(h.event.id)).toBeNull();
    expect(await h.db.approvals.listPending()).toEqual([]);
    expect((await h.db.events.getById(h.event.id))?.status).toBe('RECEIVED');
  });

  it('lets the model choose a different legal profile and validation order', async () => {
    const h = await setupAgent();
    h.chooseTool.mockImplementation(async (messages) => JSON.stringify(permittedCalls(messages).at(-1)));
    const result = await runUrgentJobAgent({ eventId: h.event.id, tools: h.tools, model: h.model });
    expect(result.comparisonReady).toBe(true);
    expect(h.scheduler.propose.mock.calls[0]?.[0].profile).toBe('minimal_disruption');
  });

  it('fails as a blocked dependency with an explicitly unfinished scheduler, not as infeasible', async () => {
    const h = await setupAgent();
    const result = await runUrgentJobAgent({ eventId: h.event.id, tools: createUrgentTools(h.db, {
      propose: () => ({ plans: [], engine: 'insertion', timedOut: false, message: 'not_implemented' }),
      validate: h.scheduler.validate,
    }), model: h.model });
    expect(result.status).toBe('blocked_dependency');
    expect(result.errorCode).toBe('SCHEDULER_NOT_IMPLEMENTED');
    expect(result.plans).toEqual([]);
  });

  it('does not let the solver self-certify a plan the independent validator rejects', async () => {
    const h = await setupAgent();
    h.scheduler.validate.mockReturnValue({ ok: false, violations: ['missing_cert'] });
    const result = await runUrgentJobAgent({ eventId: h.event.id, tools: h.tools, model: h.model });
    expect(result.status).toBe('no_candidates');
    expect(result.plans).toEqual([]);
    expect(result.trace.filter((step) => step.tool === 'validate').every((step) => step.result.ok === false)).toBe(true);
    expect(await h.db.boardSnapshots.getLatest()).toEqual(h.snapshot);
  });

  it('does not resurrect a solver-rejected plan even if the validator says OK', async () => {
    const h = await setupAgent();
    const original = h.scheduler.propose.getMockImplementation()!;
    h.scheduler.propose.mockImplementation((input) => {
      const output = original(input);
      output.plans[0]!.status = 'REJECTED';
      return output;
    });
    const result = await runUrgentJobAgent({ eventId: h.event.id, tools: h.tools, model: h.model });
    expect(result.plans).toEqual([]);
  });

  it('rejects a snapshot that changes between steps', async () => {
    const h = await setupAgent();
    const original = h.chooseTool.getMockImplementation()!;
    let calls = 0;
    h.chooseTool.mockImplementation(async (messages) => {
      if (++calls === 2) await h.db.boardSnapshots.createSnapshot(h.snapshot.snapshotData);
      return original(messages);
    });
    const result = await runUrgentJobAgent({ eventId: h.event.id, tools: h.tools, model: h.model });
    expect(result.status).toBe('superseded');
    expect(result.errorCode).toBe('STALE_SNAPSHOT');
    expect(h.scheduler.propose).not.toHaveBeenCalled();
  });

  it('returns explicit failure at the graph recursion bound with no candidate leakage', async () => {
    const h = await setupAgent();
    const result = await runUrgentJobAgent({ eventId: h.event.id, tools: h.tools, model: h.model, maxSteps: 1 });
    expect(result.errorCode).toBe('AGENT_RECURSION_LIMIT');
    expect(result.plans).toEqual([]);
    expect(result.trace).toHaveLength(1);
  });

  it('bounds a hung model by the whole-run timeout', async () => {
    const h = await setupAgent();
    const model = { chooseTool: vi.fn(() => new Promise<string>(() => {})) };
    const result = await runUrgentJobAgent({ eventId: h.event.id, tools: h.tools, model, timeoutMs: 20 });
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('AGENT_ABORTED');
    expect(h.scheduler.propose).not.toHaveBeenCalled();
  });

  it('uses platform live rows and excludes superseded assignments, not historical snapshot blobs', async () => {
    const h = await setupAgent();
    const before = await h.tools.readContext(h.event.id);
    const original = before.schedule.assignments[0]!;
    await h.db.assignments.supersede(original.id, 'reassigned');
    const replacement = await h.db.assignments.createCommitted({
      jobId: original.jobId, technicianId: original.technicianId,
      snapshotId: h.snapshot.id, windowStart: original.windowStart, windowEnd: original.windowEnd,
    });
    const context = await h.tools.readContext(h.event.id);
    expect(context.schedule.assignments.map((slot) => slot.id)).not.toContain(original.id);
    expect(context.schedule.assignments.map((slot) => slot.id)).toContain(replacement.id);
    expect(context.schedule.assignments).toHaveLength(before.schedule.assignments.length);
    expect(context.schedule.snapshotId).toBe(h.snapshot.id);
  });

  // Real scheduling legality is asserted separately in real-scheduler.acceptance.test.ts.
  // RUN_SCHEDULER_ACCEPTANCE=1 is required before closing G1; four upstream checks remain open.
  it.todo('A-01 G2: recommendation matches backend metrics (recommendation not implemented at G1)');
});
