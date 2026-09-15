import { vi } from 'vitest';
import { InMemoryDatabase } from '../../src/db/memory';
import { emptyPlanMetrics } from '../../src/shared/types/domain';
import type { CandidatePlan, ProposeInput } from '../../src/shared/types/domain';
import type { GatewayMessage, ToolModel } from '../../src/agent/runtime/gateway';
import { createUrgentTools } from '../../src/agent/tools/urgent';
import type { UrgentToolCall } from '../../src/agent/tools/protocol';

/** Deterministic model double: NOT evidence of a live gateway run. */
export function permittedCalls(messages: GatewayMessage[]): UrgentToolCall[] {
  const line = messages.at(-1)!.content.split('\n').find((value) => value.startsWith('TRUSTED_STATE='));
  if (!line) throw new Error('Missing trusted state');
  return JSON.parse(line.slice('TRUSTED_STATE='.length)).allowedCalls;
}

/** Contract fixtures only: NOT evidence that member 2's scheduler/validator works. */
export function fixturePlan(input: ProposeInput): CandidatePlan {
  return {
    id: `fixture_${input.profile}`, proposalId: `fixture_${input.event.id}`,
    sourceSnapshotId: input.schedule.snapshotId, profile: input.profile,
    assignments: [{ jobId: 'job_raffles', technicianId: input.profile === 'sla_first' ? 'tech_siti' : 'tech_jonah' }],
    changeSet: [], metrics: { ...emptyPlanMetrics(), travelMinutes: input.profile === 'sla_first' ? 34 : 46 },
    validations: { ok: true, violations: [] }, solverTrace: { fixture: true },
    timedOut: false, status: 'VALIDATED', createdAt: '2026-09-15T00:00:00Z',
  };
}

export async function setupAgent(rawText = '') {
  const db = new InMemoryDatabase();
  const snapshot = (await db.boardSnapshots.getLatest())!;
  const event = await db.events.create({
    type: 'urgent_job', rawText, normalizedPayload: { jobId: 'job_raffles' },
    sourceSnapshotId: snapshot.id, affectedIds: ['job_raffles'], validationIssues: [], status: 'RECEIVED',
  });
  const scheduler = {
    propose: vi.fn((input: ProposeInput) => ({ plans: [fixturePlan(input)], engine: 'insertion' as const, timedOut: false })),
    validate: vi.fn(() => ({ ok: true, violations: [] as string[] })),
  };
  const tools = createUrgentTools(db, scheduler);
  const chooseTool = vi.fn(async (messages: GatewayMessage[]) => JSON.stringify(permittedCalls(messages)[0]));
  const model: ToolModel = { chooseTool };
  return { db, event, snapshot, scheduler, tools, model, chooseTool };
}
