// The seam between proposeWithSidecar and the OR-Tools service, pinned without
// a running solver so it is checked on every commit.
//
// CI has never had a sidecar, so every earlier test took the insertion
// fallback and passed while the real solver, reachable only on the box, placed
// every job at 09:00-10:30 and ignored certificates. G-08 runs the real solver;
// this file pins the contract around it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryDatabase } from '../db/memory';
import { buildBoardSchedule } from '../dispatch/board-schedule';
import { proposeWithSidecar } from './propose';

async function unavailableHafiz() {
  const db = new InMemoryDatabase();
  const schedule = await buildBoardSchedule(db);
  const snapshot = await db.boardSnapshots.getLatest();
  const event = await db.events.create({
    type: 'technician_unavailable',
    rawText: '',
    normalizedPayload: { technicianId: 'tech_hafiz' },
    sourceSnapshotId: snapshot!.id,
    affectedIds: ['tech_hafiz'],
    validationIssues: [],
    status: 'VALIDATED',
  });
  return { event, schedule };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('proposeWithSidecar request and fallback', () => {
  it("sends Stage A's eligibility, so the solver never decides legality itself", async () => {
    const { event, schedule } = await unavailableHafiz();
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ plans: [], engine: 'ortools', timedOut: false })));
    vi.stubGlobal('fetch', fetcher);

    await proposeWithSidecar({ event, schedule, profile: 'sla_first' });

    const init = fetcher.mock.calls[0]![1]!;
    const body = JSON.parse(String(init.body)) as { eligibility?: Record<string, string[]> };
    expect(body.eligibility).toBeDefined();
    // Wei holds neither certificate Raffles Place needs, so Stage A excludes him.
    expect(body.eligibility!.job_raffles).not.toContain('tech_wei');
    expect(Object.keys(body.eligibility!)).toHaveLength(schedule.jobs.length);
  });

  it('does not call an answered "infeasible" a timeout', async () => {
    const { event, schedule } = await unavailableHafiz();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      plans: [], engine: 'ortools', timedOut: false, message: 'cp_sat_infeasible',
    }))));

    const out = await proposeWithSidecar({ event, schedule, profile: 'sla_first' });

    // Insertion still gets its turn, but the verdict is not dressed up as a
    // timeout: that would map to the retryable scheduler_timeout, and a
    // coordinator would retry something no legal plan can satisfy.
    expect(out.engine).toBe('insertion');
    expect(out.timedOut).toBe(false);
  });

  it('does report a timeout when the sidecar never answers', async () => {
    const { event, schedule } = await unavailableHafiz();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));

    const out = await proposeWithSidecar({ event, schedule, profile: 'sla_first' });

    expect(out.engine).toBe('insertion');
    expect(out.timedOut).toBe(true);
  });

  it('re-validates whatever the sidecar returns rather than trusting it', async () => {
    const { event, schedule } = await unavailableHafiz();
    // A plan the solver claims is fine: Wei on Raffles Place, the v1.1 blocker.
    const claimed = {
      id: 'plan_x', proposalId: event.id, sourceSnapshotId: schedule.snapshotId, profile: 'sla_first',
      assignments: [{
        jobId: 'job_raffles', technicianId: 'tech_wei',
        windowStart: '2026-09-15T13:00:00+08:00', windowEnd: '2026-09-15T14:30:00+08:00',
      }],
      changeSet: [], metrics: { slaLatenessMinutes: 0, travelMinutes: 0, overtimeMinutes: 0, jobsMoved: 0,
        customersAffected: 0, unassignedCount: 0 },
      validations: { ok: true, violations: [] }, solverTrace: {}, timedOut: false, status: 'VALIDATED',
      createdAt: '2026-09-15T08:00:00+08:00',
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      plans: [claimed], engine: 'ortools', timedOut: false,
    }))));

    const out = await proposeWithSidecar({ event, schedule, profile: 'sla_first' });

    expect(out.plans[0]!.validations.ok).toBe(false);
    expect(out.plans[0]!.validations.violations.join(' ')).toContain('MISSING_CERT');
  });
});
