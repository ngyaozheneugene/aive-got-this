// G1 integration seam: platform owns persistence; the existing graph owns tool dispatch.
// Platform review required. No assignments, snapshots, approvals or SQL are written here.
import { randomUUID } from 'node:crypto';
import type { IDatabase } from '../db/interface';
import { createGatewayClient, readGatewayConfig } from '../agent/runtime/gateway';
import type { ToolModel } from '../agent/runtime/gateway';
import { runStructuredRecovery, runUrgentJobAgent, shouldUseStructuredFallback } from '../agent/runtime/urgent-graph';
import { createUrgentTools } from '../agent/tools/urgent';
import type { SchedulerPort } from '../agent/tools/urgent';
import { planningContextFingerprint } from '../agent/tools/context-fingerprint';
import { AgentError } from '../agent/runtime/errors';
import { classifyProposalRisk } from '../agent/policy/risk';
import { compareCandidatePlans } from '../agent/policy/compare';
import { candidatePlanSchema } from '../shared/contracts/propose';
import type {
  CandidatePlan, OperationalEventStatus, PlanProfile, Proposal, SolverEngine,
} from '../shared/types/domain';
import { PlanningError, planningError } from './planning-errors';

export interface PlanEventInput { eventId: string; profile: PlanProfile; signal?: AbortSignal }
export interface PlanEventDependencies {
  /** Test seams supply ports, never replace the graph or the persistence implementation. */
  createModel?: () => ToolModel;
  scheduler?: SchedulerPort;
}
export type PlanEventResult =
  | { ok: true; proposal: Proposal; plans: CandidatePlan[]; engine: SolverEngine; timedOut: boolean;
      comparisonReady: boolean; comparisonReasons: string[];
      selectionBasis: 'requested_profile' | 'available_validated_plan';
      agent: { runId: string; protocol: string; modelCalls: number; status: 'candidates_ready' } }
  | { ok: false; code: string; httpStatus: number; detail: string };

// Protect same-event duplicate calls within this process/DB instance, not across workers.
// A DB-backed claim/transaction is required before multi-worker/Postgres acceptance.
const running = new WeakMap<IDatabase, Set<string>>();

export async function planUrgentEvent(
  db: IDatabase, input: PlanEventInput, dependencies: PlanEventDependencies = {},
): Promise<PlanEventResult> {
  let active = running.get(db);
  if (!active) { active = new Set(); running.set(db, active); }
  if (active.has(input.eventId)) {
    return { ok: false, code: 'planning_in_progress', httpStatus: 409, detail: 'This event is already being planned.' };
  }
  active.add(input.eventId);
  let claimed = false;
  let proposalId: string | undefined;
  // The status planning took the event from, so an infrastructure failure that
  // wrote nothing can hand it back instead of consuming it.
  let priorStatus: OperationalEventStatus | undefined;
  const runId = randomUUID();
  const checkCancelled = () => { if (input.signal?.aborted) throw new AgentError('AGENT_ABORTED'); };
  try {
    const tools = createUrgentTools(db, dependencies.scheduler);
    checkCancelled();
    const event = await db.events.getById(input.eventId);
    if (!event) throw new PlanningError('event_not_found', 404, 'No event with that id.');
    if (!['urgent_job', 'technician_unavailable', 'job_overrun'].includes(event.type)) {
      throw new PlanningError('unsupported_event_type', 422,
        'This endpoint supports urgent_job, technician_unavailable and job_overrun only.');
    }
    if (event.status === 'PLANNING') throw new PlanningError('planning_in_progress', 409, 'This event is already being planned.');
    if (!['RECEIVED', 'VALIDATED'].includes(event.status)) {
      throw new PlanningError('event_not_plannable', 409, 'Raise a new event instead of replanning a terminal or completed event.');
    }
    if (await db.proposals.getByEventId(event.id)) {
      throw new PlanningError('proposal_exists', 409, 'This event already has a proposal. Read the existing result or raise a new event.');
    }
    // Validate the stored event and snapshot before using gateway quota.
    await tools.readContext(event.id);
    checkCancelled();
    priorStatus = event.status;
    await db.events.updateStatus(event.id, 'PLANNING');
    claimed = true;
    const model = (dependencies.createModel ?? (() => createGatewayClient(readGatewayConfig()).model))();
    let result = await runUrgentJobAgent({ eventId: event.id, tools, model, signal: input.signal });
    if ((result.status === 'failed' || result.status === 'blocked_dependency')
        && shouldUseStructuredFallback(result.errorCode)) {
      const fallback = await runStructuredRecovery({ eventId: event.id, tools, signal: input.signal });
      if (fallback.status === 'candidates_ready' || fallback.status === 'no_candidates') {
        const bridge = {
          sequence: result.trace.length + 1, tool: 'structured_fallback', args: { eventId: event.id },
          result: { claimedModelRan: false, gatewayError: result.errorCode }, durationMs: 0, outcome: 'ok' as const,
        };
        result = {
          ...fallback,
          modelCalls: result.modelCalls,
          trace: [...result.trace, bridge, ...fallback.trace.map((step, index) => ({
            ...step, sequence: result.trace.length + 2 + index,
          }))],
        };
      }
    }

    // Persist observed tool evidence, not assistant prose. No credentials or raw notes.
    const previous = await db.decisionLogs.listByEvent(event.id);
    let sequence = previous.reduce((n, entry) => Math.max(n, entry.sequence ?? 0), 0);
    for (const step of result.trace) {
      await db.decisionLogs.create({
        eventId: event.id, eventType: event.type, playbook: event.type, sequence: ++sequence,
        stage: step.tool, toolCalls: [{ tool: step.tool, args: step.args, result: { ...step.result, runId } }],
        summary: step.tool === 'structured_fallback'
          ? 'Gateway unavailable; structured propose() ran. The model did not produce this plan.'
          : `Agent tool ${step.tool}: ${step.outcome}.`,
        durationMs: step.durationMs,
        reasonCodes: step.outcome === 'error' ? ['agent_step_failed']
          : step.tool === 'structured_fallback' ? ['structured_fallback'] : [],
        result: step.outcome,
      });
    }
    checkCancelled();
    if (result.status === 'superseded') throw new AgentError('PLANNING_CONTEXT_CHANGED');
    if (result.status === 'failed' || result.status === 'blocked_dependency') {
      throw new AgentError(result.errorCode ?? 'AGENT_FAILED');
    }
    const timedOut = result.trace.some((step) => step.tool === 'propose' && step.result.timedOut === true) ||
      result.plans.some((plan) => plan.timedOut);
    if (result.status === 'no_candidates') {
      if (timedOut) {
        // Explicitly not proven infeasible: the scheduler ran out of time, which
        // is the same class of failure as the gateway being slow. Nothing was
        // written, so the event stays plannable and the run can be repeated.
        throw new PlanningError('scheduler_timeout', 504,
          'The scheduler timed out without an accepted candidate.', 'FAILED', true);
      }
      throw new PlanningError('no_candidate_plans', 409, 'No candidate passed the configured validation checks.', 'INFEASIBLE');
    }
    if (result.status !== 'candidates_ready' || result.plans.length === 0 ||
        !result.sourceSnapshotId || !result.sourceContextFingerprint) throw new AgentError('INVALID_AGENT_RESULT');

    const plans = result.plans.map((plan) => candidatePlanSchema.parse(plan));
    const ids = new Set<string>();
    for (const plan of plans) {
      if (ids.has(plan.id) || plan.sourceSnapshotId !== result.sourceSnapshotId ||
          plan.status === 'REJECTED' || !plan.validations.ok || plan.validations.violations.length) {
        throw new AgentError('INVALID_AGENT_RESULT');
      }
      ids.add(plan.id);
    }
    const assertFresh = async () => {
      checkCancelled();
      const current = await tools.readContext(event.id, result.sourceSnapshotId);
      if (planningContextFingerprint(current) !== result.sourceContextFingerprint) {
        throw new AgentError('PLANNING_CONTEXT_CHANGED');
      }
      checkCancelled();
    };
    await assertFresh();
    const engines = new Set(result.trace.filter((step) => step.tool === 'propose' && step.outcome === 'ok')
      .map((step) => step.result.engine));
    const reportedEngine = [...engines][0];
    if (engines.size !== 1 || (reportedEngine !== 'insertion' && reportedEngine !== 'ortools')) {
      throw new AgentError('INVALID_AGENT_ENGINE');
    }
    const engine: SolverEngine = reportedEngine;
    const preferred = plans.find((plan) => plan.profile === input.profile);
    const selected = preferred ?? plans[0]!;
    const selectionBasis = preferred ? 'requested_profile' as const : 'available_validated_plan' as const;

    const context = await tools.readContext(event.id, result.sourceSnapshotId);
    if (planningContextFingerprint(context) !== result.sourceContextFingerprint) {
      throw new AgentError('PLANNING_CONTEXT_CHANGED');
    }
    const classification = classifyProposalRisk({
      plans, liveAssignments: context.schedule.assignments,
    });
    await db.decisionLogs.create({
      eventId: event.id, eventType: event.type, playbook: event.type, sequence: ++sequence,
      stage: 'classify_risk',
      toolCalls: [{ tool: 'classify_risk', args: { eventId: event.id, planIds: plans.map((plan) => plan.id) },
        result: { runId, risk: classification.risk, autonomyMode: classification.autonomyMode,
          reasons: classification.reasons } }],
      summary: `Risk ${classification.risk} (${classification.autonomyMode}) from stored plan evidence, not a model score.`,
      reasonCodes: classification.reasons, result: classification.autonomyMode,
    });
    const comparison = compareCandidatePlans(plans);
    await db.decisionLogs.create({
      eventId: event.id, eventType: event.type, playbook: event.type, sequence: ++sequence,
      stage: 'compare_plans',
      toolCalls: [{ tool: 'compare_plans', args: { eventId: event.id },
        result: { runId, ...comparison } }],
      summary: comparison.comparisonReady
        ? 'Compared stored backend metrics for sla_first vs minimal_disruption. The model did not rank them.'
        : comparison.reasons.includes('identical_plans')
          ? 'Both profiles assigned the same slots. This is not a comparison.'
          : 'Only one validated profile is available; this is not a comparison.',
      reasonCodes: comparison.reasons,
      result: comparison.comparisonReady ? 'comparison_ready'
        : comparison.reasons.includes('identical_plans') ? 'identical_plans' : 'incomplete_comparison',
    });

    const proposal = await db.proposals.create({ eventId: event.id, sourceSnapshotId: result.sourceSnapshotId,
      risk: classification.risk, autonomyMode: classification.autonomyMode, status: 'GENERATING' });
    proposalId = proposal.id;
    const savedPlans: CandidatePlan[] = [];
    const storedIds: Record<string, string> = Object.create(null);
    for (const plan of plans) {
      checkCancelled();
      const { id: schedulerId, createdAt: _createdAt, ...data } = plan;
      const saved = await db.candidatePlans.create({ ...data, proposalId: proposal.id,
        status: schedulerId === selected.id ? 'RECOMMENDED' : 'VALIDATED' });
      savedPlans.push(saved);
      storedIds[schedulerId] = saved.id;
    }
    // Catch changes during persistence, including a same-snapshot shift/cert change.
    await assertFresh();
    const recommendedId = storedIds[selected.id];
    if (!recommendedId) throw new AgentError('INVALID_STORED_PLAN');
    await db.decisionLogs.create({
      eventId: event.id, eventType: event.type, playbook: event.type, sequence: ++sequence,
      stage: 'persist_proposal',
      toolCalls: [{ tool: 'persist_proposal', args: { eventId: event.id },
        result: { runId, proposalId: proposal.id, storedPlanIds: storedIds, selectionBasis, engine, timedOut,
          claimedModelRan: result.protocol !== 'structured_fallback' } }],
      summary: `Stored ${savedPlans.length} agent-validated candidate(s); selected ${selected.profile} by ${selectionBasis}, not model ranking.`,
      reasonCodes: [selectionBasis], result: 'candidates_stored',
    });
    await assertFresh();
    const updated = await db.proposals.updateStatus(proposal.id, 'RECOMMENDED', recommendedId);
    checkCancelled();
    await db.events.updateStatus(event.id,
      classification.autonomyMode === 'approval' ? 'AWAITING_APPROVAL' : 'PROPOSAL_READY');
    return { ok: true, proposal: updated, plans: savedPlans, engine, timedOut,
      comparisonReady: comparison.comparisonReady, comparisonReasons: comparison.reasons, selectionBasis,
      agent: { runId,
        protocol: result.protocol === 'structured_fallback' ? 'structured_fallback' : (model.protocol ?? 'strict_json'),
        modelCalls: result.modelCalls, status: 'candidates_ready' } };
  } catch (error) {
    const failure = planningError(error);
    // Best-effort invalidation, NOT a rollback or a transaction. Keep partial rows for review.
    // Never overwrite a concurrently committed/rejected event's terminal state.
    try {
      const partial = proposalId ? await db.proposals.getById(proposalId) : null;
      if (partial && ['GENERATING', 'RECOMMENDED'].includes(partial.status)) {
        await db.proposals.updateStatus(partial.id, failure.eventStatus === 'SUPERSEDED' ? 'SUPERSEDED' : 'REJECTED');
      }
      if (claimed && (await db.events.getById(input.eventId))?.status === 'PLANNING') {
        // A gateway outage or a timeout says nothing about the event, and if no
        // proposal row was written there is nothing to review. Give the event
        // back so the same request can simply be retried once the dependency
        // recovers. Anything else, or any partial write, stays terminal.
        const restore = failure.retryable && !proposalId && priorStatus;
        await db.events.updateStatus(input.eventId, restore ? priorStatus! : failure.eventStatus);
      }
    } catch {
      return { ok: false, code: 'planning_cleanup_failed', httpStatus: 500,
        detail: 'Planning failed and its partial records need operator review. No schedule was committed by this request.' };
    }
    return { ok: false, code: failure.code, httpStatus: failure.httpStatus, detail: failure.detail };
  } finally {
    active.delete(input.eventId);
  }
}
