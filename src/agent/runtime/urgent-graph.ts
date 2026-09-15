import { Annotation, END, GraphRecursionError, START, StateGraph } from '@langchain/langgraph';
import type { CandidatePlan } from '../../shared/types/domain';
import { planValidationSchema, proposeOutputSchema } from '../../shared/contracts/propose';
import { AGENT_RECURSION_LIMIT, SOLVER_TIMEOUT_MS } from '../../shared/config/timeouts';
import { allowedUrgentCalls, MAX_CANDIDATES_PER_PROFILE, validatedCandidates } from '../playbooks/urgent';
import type { AgentTraceStep, UrgentProgress, UrgentStatus } from '../playbooks/urgent';
import { buildUrgentMessages } from '../prompts/urgent';
import { parseToolCall, sameToolCall } from '../tools/protocol';
import type { UrgentToolCall } from '../tools/protocol';
import type { UrgentTools } from '../tools/urgent';
import { planningContextFingerprint } from '../tools/context-fingerprint';
import type { ToolModel } from './gateway';
import { bounded } from './bounds';
import { AgentError, errorCode } from './errors';

const GraphState = Annotation.Root({
  progress: Annotation<UrgentProgress>(),
  status: Annotation<UrgentStatus>(),
  trace: Annotation<AgentTraceStep[]>({ reducer: (left, right) => left.concat(right), default: () => [] }),
  errorCode: Annotation<string | undefined>(),
});
type State = typeof GraphState.State;

export interface UrgentAgentResult {
  eventId: string;
  sourceSnapshotId?: string;
  status: UrgentStatus;
  plans: CandidatePlan[];
  comparisonReady: boolean;
  trace: AgentTraceStep[];
  errorCode?: string;
  modelCalls: number;
}
export interface UrgentAgentInput {
  eventId: string;
  tools: UrgentTools;
  model: ToolModel;
  signal?: AbortSignal;
  maxSteps?: number;
  timeoutMs?: number;
}

/** G1 ends at independently validated candidates. No persistence or commit capability. */
export async function runUrgentJobAgent(input: UrgentAgentInput): Promise<UrgentAgentResult> {
  const maxSteps = input.maxSteps ?? AGENT_RECURSION_LIMIT;
  const timeoutMs = input.timeoutMs ?? 90_000;
  if (!input.eventId || !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > AGENT_RECURSION_LIMIT ||
      !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) throw new AgentError('INVALID_AGENT_OPTIONS');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
  let modelCalls = 0;
  let last: State = {
    progress: { eventId: input.eventId, proposedProfiles: [], candidates: [], validatedPlanIds: [] },
    status: 'running', trace: [], errorCode: undefined,
  };

  async function step(state: State): Promise<Partial<State>> {
    const started = Date.now();
    let request: UrgentToolCall | undefined;
    try {
      const allowed = allowedUrgentCalls(state.progress);
      if (!allowed.length) throw new AgentError('EMPTY_TOOL_FRONTIER');
      const reply = await bounded((turnSignal) => {
        modelCalls += 1;
        return input.model.chooseTool(
          buildUrgentMessages(state.progress, input.model.protocol, state.trace.at(-1)), turnSignal, allowed,
        );
      },
        65_000, signal, 'GATEWAY_TIMEOUT');
      request = parseToolCall(reply);
      if (!allowed.some((choice) => sameToolCall(choice, request!))) throw new AgentError('TOOL_NOT_ALLOWED_IN_STATE');
      const expected = state.progress.context?.schedule.snapshotId;
      const context = await bounded(() => input.tools.readContext(input.eventId, expected), SOLVER_TIMEOUT_MS, signal);
      if (context.event.id !== input.eventId || (expected && context.schedule.snapshotId !== expected)) {
        throw new AgentError('STALE_SNAPSHOT');
      }
      if (state.progress.context && JSON.stringify(context.event.normalizedPayload) !==
          JSON.stringify(state.progress.context.event.normalizedPayload)) throw new AgentError('EVENT_CHANGED');
      if (state.progress.context && planningContextFingerprint(context) !==
          planningContextFingerprint(state.progress.context)) throw new AgentError('PLANNING_CONTEXT_CHANGED');
      const progress: UrgentProgress = { ...state.progress, context };
      let result: Record<string, unknown>;

      if (request.tool === 'retrieve_board') {
        result = { eventId: context.event.id, sourceSnapshotId: context.schedule.snapshotId, jobs: context.schedule.jobs.length,
          technicians: context.schedule.technicians.length };
      } else if (request.tool === 'propose') {
        const profile = request.args.profile;
        const raw = await bounded(() => input.tools.propose({ event: context.event,
          schedule: context.schedule, profile }), SOLVER_TIMEOUT_MS, signal);
        const parsed = proposeOutputSchema.safeParse(raw);
        if (!parsed.success) throw new AgentError('INVALID_SCHEDULER_RESULT');
        const output = parsed.data;
        if (output.engine === 'stub' || output.message === 'not_implemented') throw new AgentError('SCHEDULER_NOT_IMPLEMENTED');
        if (output.plans.length > MAX_CANDIDATES_PER_PROFILE) throw new AgentError('TOO_MANY_CANDIDATES');
        const seen = new Set(progress.candidates.map((plan) => plan.id));
        for (const plan of output.plans) {
          if (!plan.id || !plan.proposalId || seen.has(plan.id)) throw new AgentError('INVALID_CANDIDATE_ID');
          if (plan.sourceSnapshotId !== context.schedule.snapshotId || plan.profile !== profile) {
            throw new AgentError('CANDIDATE_CONTEXT_MISMATCH');
          }
          seen.add(plan.id);
        }
        progress.proposedProfiles = [...progress.proposedProfiles, profile];
        progress.candidates = [...progress.candidates, ...structuredClone(output.plans)];
        result = { profile, engine: output.engine, timedOut: output.timedOut, planIds: output.plans.map((plan) => plan.id) };
      } else {
        const planId = request.args.planId;
        const plan = progress.candidates.find((candidate) => candidate.id === planId);
        if (!plan) throw new AgentError('UNKNOWN_CANDIDATE');
        const raw = await bounded(() => input.tools.validate(structuredClone(plan), context.schedule), SOLVER_TIMEOUT_MS, signal);
        const parsed = planValidationSchema.safeParse(raw);
        if (!parsed.success) throw new AgentError('INVALID_VALIDATOR_RESULT');
        const violations = [...new Set([...plan.validations.violations, ...parsed.data.violations])];
        const ok = plan.status !== 'REJECTED' && plan.validations.ok && parsed.data.ok && violations.length === 0;
        const checked: CandidatePlan = { ...plan, validations: { ok, violations }, status: ok ? 'VALIDATED' : 'REJECTED' };
        progress.candidates = progress.candidates.map((candidate) => candidate.id === plan.id ? checked : candidate);
        progress.validatedPlanIds = [...progress.validatedPlanIds, plan.id];
        result = { planId: plan.id, ok, violations };
      }

      let status: UrgentStatus = 'running';
      if (!allowedUrgentCalls(progress).length) {
        const fresh = await bounded(() => input.tools.readContext(input.eventId, context.schedule.snapshotId), SOLVER_TIMEOUT_MS, signal);
        if (fresh.schedule.snapshotId !== context.schedule.snapshotId) throw new AgentError('STALE_SNAPSHOT');
        if (planningContextFingerprint(fresh) !== planningContextFingerprint(context)) {
          throw new AgentError('PLANNING_CONTEXT_CHANGED');
        }
        status = validatedCandidates(progress).length ? 'candidates_ready' : 'no_candidates';
      }
      const trace: AgentTraceStep = { sequence: state.trace.length + 1, tool: request.tool,
        args: request.args, result, durationMs: Date.now() - started, outcome: 'ok' };
      last = { progress, status, trace: [...state.trace, trace], errorCode: undefined };
      return { progress, status, trace: [trace] };
    } catch (error) {
      const code = errorCode(error, 'TOOL_FAILED');
      const status: UrgentStatus = code === 'SCHEDULER_NOT_IMPLEMENTED' ? 'blocked_dependency' :
        ['STALE_SNAPSHOT', 'PLANNING_CONTEXT_CHANGED'].includes(code) ? 'superseded' : 'failed';
      const trace: AgentTraceStep = { sequence: state.trace.length + 1, tool: request?.tool ?? 'supervisor',
        args: request?.args ?? {}, result: { errorCode: code }, durationMs: Date.now() - started, outcome: 'error' };
      last = { ...state, status, errorCode: code, trace: [...state.trace, trace] };
      return { status, errorCode: code, trace: [trace] };
    }
  }

  try {
    const graph = new StateGraph(GraphState)
      .addNode('supervisor_step', step)
      .addEdge(START, 'supervisor_step')
      .addConditionalEdges('supervisor_step', (state) => state.status === 'running' ? 'supervisor_step' : END,
        ['supervisor_step', END])
      .compile();
    last = await graph.invoke(last, { recursionLimit: maxSteps });
  } catch (error) {
    const code = signal.aborted ? 'AGENT_ABORTED' : error instanceof GraphRecursionError ? 'AGENT_RECURSION_LIMIT' : 'GRAPH_FAILED';
    last = { ...last, status: 'failed', errorCode: code };
  } finally {
    clearTimeout(timer);
  }
  const plans = last.status === 'candidates_ready' ? validatedCandidates(last.progress) : [];
  return {
    eventId: input.eventId, sourceSnapshotId: last.progress.context?.schedule.snapshotId,
    status: last.status, plans, comparisonReady: new Set(plans.map((plan) => plan.profile)).size === 2,
    trace: last.trace, errorCode: last.errorCode, modelCalls,
  };
}
