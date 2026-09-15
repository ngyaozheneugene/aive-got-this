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

  it('fails as a blocked dependency with the actual unfinished scheduler, not as infeasible', async () => {
    const h = await setupAgent();
    const result = await runUrgentJobAgent({ eventId: h.event.id, tools: createUrgentTools(h.db), model: h.model });
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

  it('uses complete committed snapshot slots rather than stale active assignment rows', async () => {
    const h = await setupAgent();
    const next = await h.db.boardSnapshots.createSnapshot({ date: h.snapshot.snapshotData.date,
      assignments: [{ jobId: 'job_raffles', technicianId: 'tech_siti' }] });
    const event = await h.db.events.create({ ...h.event, sourceSnapshotId: next.id });
    const context = await h.tools.readContext(event.id);
    expect(context.schedule.assignments).toHaveLength(1);
    expect(context.schedule.assignments[0]?.technicianId).toBe('tech_siti');
    expect(context.schedule.snapshotId).toBe(next.id);
  });

  it.todo('A-01 acceptance: real member-2 insertion + independent validator produce two legal Raffles plans');
  it.todo('A-01 G2: recommendation matches backend metrics (recommendation not implemented at G1)');
});
