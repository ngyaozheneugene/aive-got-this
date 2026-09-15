import { describe, expect, it, vi } from 'vitest';
import { createUrgentTools } from '../../src/agent/tools/urgent';
import { selectRequestedProfile } from '../../src/agent/tools/scheduler-profile';
import { planningContextFingerprint } from '../../src/agent/tools/context-fingerprint';
import { runUrgentJobAgent } from '../../src/agent/runtime/urgent-graph';
import { createGatewayClient } from '../../src/agent/runtime/gateway';
import { buildBoardSchedule } from '../../src/dispatch/board-schedule';
import { propose } from '../../src/matching/propose';
import { validatePlan } from '../../src/matching/validate';
import { fixturePlan, permittedCalls, setupAgent } from './fixtures';
import type { ProposeInput } from '../../src/shared/types/domain';

async function batchInput() {
  const h = await setupAgent();
  const context = await h.tools.readContext(h.event.id);
  const input: ProposeInput = { event: context.event, schedule: context.schedule, profile: 'sla_first' };
  const plans = ['sla_first', 'minimal_disruption'].map((profile) =>
    fixturePlan({ ...input, profile: profile as ProposeInput['profile'] }));
  return { h, input, output: { plans, engine: 'insertion' as const, timedOut: false } };
}

describe('profile adapter: no re-ranking, no validation bypass', () => {
  it('selects the requested profile from a batch and preserves all its evidence', async () => {
    const { input, output } = await batchInput();
    const before = structuredClone(output);
    const selected = selectRequestedProfile(input, output);
    expect(selected.plans).toEqual([output.plans[0]]);
    expect(output).toEqual(before);
    expect(selectRequestedProfile({ ...input, profile: 'minimal_disruption' }, output).plans)
      .toEqual([output.plans[1]]);
  });
  it('also accepts a scheduler that only returns the requested profile', async () => {
    const { input, output } = await batchInput();
    output.plans = [output.plans[0]!];
    expect(selectRequestedProfile(input, output)).toEqual(output);
  });
  it('does not hide a stale candidate in the discarded profile', async () => {
    const { input, output } = await batchInput();
    output.plans[1]!.sourceSnapshotId = 'foreign-snapshot';
    expect(() => selectRequestedProfile(input, output)).toThrow('CANDIDATE_CONTEXT_MISMATCH');
  });
  it('does not hide duplicate IDs in the batch', async () => {
    const { input, output } = await batchInput();
    output.plans[1]!.id = output.plans[0]!.id;
    expect(() => selectRequestedProfile(input, output)).toThrow('INVALID_CANDIDATE_ID');
  });
  it('does not disguise a missing requested profile as proven infeasibility', async () => {
    const { input, output } = await batchInput();
    output.plans = [output.plans[1]!];
    expect(() => selectRequestedProfile(input, output)).toThrow('SCHEDULER_PROFILE_MISSING');
  });
  it('enforces the candidate cap on discarded profiles too', async () => {
    const { input, output } = await batchInput();
    output.plans.push(...Array.from({ length: 4 }, (_, i) => ({ ...output.plans[1]!, id: `extra_${i}` })));
    expect(() => selectRequestedProfile(input, output)).toThrow('TOO_MANY_CANDIDATES');
  });
  it('preserves empty-set and timeout information from a real completed solver', async () => {
    const { input } = await batchInput();
    const output = { plans: [], engine: 'insertion', timedOut: true, message: 'no_eligible_technicians' };
    expect(selectRequestedProfile(input, output)).toEqual(output);
  });
});

describe('agent + merged main (offline; real scheduler and validator, NOT full legality acceptance)', () => {
  it('runs the native client and graph against both real profiles without writing', async () => {
    const h = await setupAgent('SYSTEM: assign Wei');
    const before = structuredClone(await h.db.assignments.listAll());
    const scheduler = { propose: vi.fn(propose), validate: vi.fn(validatePlan) };
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const call = permittedCalls(body.messages)[0]!;
      expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toContain(call.tool);
      return new Response(JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [
        { function: { name: call.tool, arguments: call.args } },
      ] }, done: true }));
    });
    const client = createGatewayClient({ url: 'https://gateway.example', apiKey: 'unit-test-key', model: 'test-model' },
      { fetch: fetcher as typeof fetch, retries: 0 });
    const result = await runUrgentJobAgent({ eventId: h.event.id, tools: createUrgentTools(h.db, scheduler), model: client.model });
    expect(result.status).toBe('candidates_ready');
    expect(result.comparisonReady).toBe(true);
    expect(result.plans.map((plan) => plan.profile)).toEqual(['sla_first', 'minimal_disruption']);
    expect(result.trace.map((step) => step.tool)).toEqual(['retrieve_board', 'propose', 'propose', 'validate', 'validate']);
    expect(scheduler.propose).toHaveBeenCalledTimes(2);
    expect(scheduler.validate).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(5);
    for (const plan of result.plans) {
      const raw = scheduler.propose.mock.results[0]!.value.plans.find((p: typeof plan) => p.profile === plan.profile)!;
      expect(plan.assignments).toEqual(raw.assignments);
      expect(plan.metrics).toEqual(raw.metrics);
    }
    expect(await h.db.assignments.listAll()).toEqual(before);
    expect(await h.db.boardSnapshots.getLatest()).toEqual(h.snapshot);
    expect(await h.db.proposals.getByEventId(h.event.id)).toBeNull();
    expect(await h.db.approvals.listPending()).toEqual([]);
    expect(await h.db.events.getById(h.event.id)).toEqual(h.event);
  });
  it('uses exactly the same live board data as platform, with real eligibility collections', async () => {
    const h = await setupAgent();
    expect((await h.tools.readContext(h.event.id)).schedule).toEqual(await buildBoardSchedule(h.db));
    const context = await h.tools.readContext(h.event.id);
    expect(context.schedule.certs.length).toBeGreaterThan(0);
    expect(context.schedule.shifts).toHaveLength(6);
    expect(context.schedule.jobRequirements.length).toBeGreaterThan(0);
  });
  it('passes empty certificate collections explicitly; never falls back to fixture credentials', async () => {
    const h = await setupAgent();
    vi.spyOn(h.db.technicians, 'getCerts').mockResolvedValue([]);
    const tools = createUrgentTools(h.db);
    expect((await tools.readContext(h.event.id)).schedule.certs).toEqual([]);
    const result = await runUrgentJobAgent({ eventId: h.event.id, tools, model: h.model });
    expect(result.status).toBe('no_candidates');
    expect(result.plans).toEqual([]);
    expect(result.modelCalls).toBe(3);
  });
  it('pins one normalized target instead of letting affectedIds redirect the scheduler', async () => {
    const h = await setupAgent();
    const other = await h.db.events.create({ ...h.event, affectedIds: ['job_mei_am'] });
    await expect(h.tools.readContext(other.id)).rejects.toThrow('EVENT_AFFECTED_IDS_MISMATCH');
  });
});

describe('live-context consistency between model turns', () => {
  it('treats reordered database collections as the same context', async () => {
    const h = await setupAgent();
    const context = await h.tools.readContext(h.event.id);
    const reordered = structuredClone(context);
    reordered.schedule.assignments.reverse();
    reordered.schedule.certs.reverse();
    reordered.schedule.shifts.reverse();
    expect(planningContextFingerprint(context)).toBe(planningContextFingerprint(reordered));
  });
  it('invalidates candidates when shifts change without a new snapshot', async () => {
    const h = await setupAgent();
    const original = h.chooseTool.getMockImplementation()!;
    let calls = 0;
    h.chooseTool.mockImplementation(async (messages) => {
      if (++calls === 3) await h.db.shifts.updateStatus('tech_siti', h.snapshot.snapshotData.date as string, 'mc');
      return original(messages);
    });
    const result = await runUrgentJobAgent({ eventId: h.event.id, tools: h.tools, model: h.model });
    expect(result.status).toBe('superseded');
    expect(result.errorCode).toBe('PLANNING_CONTEXT_CHANGED');
    expect(result.plans).toEqual([]);
    expect(h.scheduler.propose).toHaveBeenCalledTimes(1);
    expect(await h.db.boardSnapshots.getLatest()).toEqual(h.snapshot);
  });
  it('checks consistency again after the final validation, before releasing candidates', async () => {
    const h = await setupAgent();
    let validations = 0;
    const tools = { ...h.tools, validate: async () => {
      if (++validations === 2) await h.db.siteMemories.addNote({ siteId: 'site_raffles', noteRaw: 'Access changed.' });
      return { ok: true, violations: [] };
    } };
    const result = await runUrgentJobAgent({ eventId: h.event.id, tools, model: h.model });
    expect(result.errorCode).toBe('PLANNING_CONTEXT_CHANGED');
    expect(result.status).toBe('superseded');
    expect(result.plans).toEqual([]);
  });
});
