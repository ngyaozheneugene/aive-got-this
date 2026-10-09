import { Annotation, END, GraphRecursionError, START, StateGraph } from '@langchain/langgraph';
import type { CandidatePlan } from '../../shared/types/domain';
import { AGENT_RECURSION_LIMIT } from '../../shared/config/timeouts';
import { allowedUrgentCalls, validatedCandidates } from '../playbooks/urgent';
import type { AgentTraceStep, UrgentProgress, UrgentStatus } from '../playbooks/urgent';
import { buildUrgentMessages } from '../prompts/urgent';
import { parseToolCall, sameToolCall } from '../tools/protocol';
import type { UrgentToolCall } from '../tools/protocol';
import type { UrgentTools } from '../tools/urgent';
import { planningContextFingerprint } from '../tools/context-fingerprint';
import type { ToolModel } from './gateway';
import { bounded } from './bounds';
import { AgentError, errorCode } from './errors';
import { applyRecoveryTool, recoveryTrace } from './recovery-step';

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
  /** Server-only generation context; persistence rechecks it before publishing. */
  sourceContextFingerprint?: string;
  status: UrgentStatus;
  plans: CandidatePlan[];
  comparisonReady: boolean;
  trace: AgentTraceStep[];
  errorCode?: string;
  modelCalls: number;
  protocol?: 'native' | 'strict_json' | 'structured_fallback';
}
export interface UrgentAgentInput {
  eventId: string;
  tools: UrgentTools;
  model?: ToolModel;
  signal?: AbortSignal;
  maxSteps?: number;
  timeoutMs?: number;
}

/** Replies with several tool calls the model may correct, per run. */
const MAX_BATCHED_RETRIES = 2;
const BATCHED_CALLS_NOTE = 'Your last reply contained more than one tool call, so none of them ran. Call exactly ONE tool from allowedCalls.';

const GATEWAY_STRUCTURED_FALLBACK = new Set([
  'GATEWAY_TIMEOUT', 'GATEWAY_NETWORK_ERROR', 'GATEWAY_FAILED',
  'GATEWAY_HTTP_408', 'GATEWAY_HTTP_429',
  'GATEWAY_HTTP_500', 'GATEWAY_HTTP_502', 'GATEWAY_HTTP_503', 'GATEWAY_HTTP_504',
]);

export function shouldUseStructuredFallback(code?: string): boolean {
  return !!code && GATEWAY_STRUCTURED_FALLBACK.has(code);
}

/** Deterministic retrieve → propose both profiles → validate. No model, no invented metrics. */
export async function runStructuredRecovery(input: Omit<UrgentAgentInput, 'model'>): Promise<UrgentAgentResult> {
  const startedRun = Date.now();
  let progress: UrgentProgress = {
    eventId: input.eventId, proposedProfiles: [], candidates: [], validatedPlanIds: [],
  };
  const trace: AgentTraceStep[] = [];
  let status: UrgentStatus = 'running';
  const maxSteps = input.maxSteps ?? AGENT_RECURSION_LIMIT;
  try {
    while (status === 'running' && trace.length < maxSteps) {
      const allowed = allowedUrgentCalls(progress);
      if (!allowed.length) {
        status = validatedCandidates(progress).length ? 'candidates_ready' : 'no_candidates';
        break;
      }
      const request = allowed[0]!;
      const started = Date.now();
      const applied = await applyRecoveryTool({
        eventId: input.eventId, progress, request, tools: input.tools, signal: input.signal,
      });
      progress = applied.progress;
      status = applied.status;
      trace.push(recoveryTrace(trace.length + 1, request, applied.result, Date.now() - started, 'ok'));
    }
    if (status === 'running') status = 'failed';
  } catch (error) {
    const code = errorCode(error, 'TOOL_FAILED');
    status = code === 'SCHEDULER_NOT_IMPLEMENTED' ? 'blocked_dependency' :
      ['STALE_SNAPSHOT', 'PLANNING_CONTEXT_CHANGED'].includes(code) ? 'superseded' : 'failed';
    trace.push(recoveryTrace(trace.length + 1, undefined, { errorCode: code }, Date.now() - startedRun, 'error'));
    return finish(input.eventId, progress, status, trace, 0, 'structured_fallback', code);
  }
  return finish(input.eventId, progress, status, trace, 0, 'structured_fallback');
}

/** G1/G3 recovery supervisor. Model chooses the next named tool; structured fallback skips the model. */
export async function runUrgentJobAgent(input: UrgentAgentInput): Promise<UrgentAgentResult> {
  if (!input.model) return runStructuredRecovery(input);
  const maxSteps = input.maxSteps ?? AGENT_RECURSION_LIMIT;
  const timeoutMs = input.timeoutMs ?? 90_000;
  if (!input.eventId || !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > AGENT_RECURSION_LIMIT ||
      !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) throw new AgentError('INVALID_AGENT_OPTIONS');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
  let modelCalls = 0;
  let batchedRetries = 0;
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
      let messages = buildUrgentMessages(state.progress, input.model!.protocol, state.trace.at(-1));
      const ask = () => bounded((turnSignal) => {
        modelCalls += 1;
        return input.model!.chooseTool(messages, turnSignal, allowed);
      },
        65_000, signal, 'GATEWAY_TIMEOUT');
      let reply: Awaited<ReturnType<typeof ask>>;
      try {
        reply = await ask();
      } catch (error) {
        // The model sometimes batches two legal steps (both validations at once).
        // Nothing from that reply runs; it is asked once more for exactly one call,
        // which must still pass the allowed-step check below. Only this error is
        // retried, at most twice a run: a wrong or forbidden tool still fails closed.
        if (errorCode(error, '') !== 'MULTIPLE_NATIVE_TOOL_CALLS' || batchedRetries >= MAX_BATCHED_RETRIES) throw error;
        batchedRetries += 1;
        // Into the last message, so the trusted state (and allowedCalls) stays last.
        const last = messages.at(-1)!;
        messages = [...messages.slice(0, -1), { ...last, content: `${BATCHED_CALLS_NOTE}\n${last.content}` }];
        reply = await ask();
      }
      request = parseToolCall(reply);
      if (!allowed.some((choice) => sameToolCall(choice, request!))) throw new AgentError('TOOL_NOT_ALLOWED_IN_STATE');
      const applied = await applyRecoveryTool({
        eventId: input.eventId, progress: state.progress, request, tools: input.tools, signal,
      });
      const trace = recoveryTrace(state.trace.length + 1, request, applied.result, Date.now() - started, 'ok');
      last = { progress: applied.progress, status: applied.status, trace: [...state.trace, trace], errorCode: undefined };
      return { progress: applied.progress, status: applied.status, trace: [trace] };
    } catch (error) {
      const code = errorCode(error, 'TOOL_FAILED');
      const status: UrgentStatus = code === 'SCHEDULER_NOT_IMPLEMENTED' ? 'blocked_dependency' :
        ['STALE_SNAPSHOT', 'PLANNING_CONTEXT_CHANGED'].includes(code) ? 'superseded' : 'failed';
      const trace = recoveryTrace(state.trace.length + 1, request, { errorCode: code }, Date.now() - started, 'error');
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
  return finish(input.eventId, last.progress, last.status, last.trace, modelCalls, input.model.protocol, last.errorCode);
}

function finish(
  eventId: string, progress: UrgentProgress, status: UrgentStatus, trace: AgentTraceStep[],
  modelCalls: number, protocol: UrgentAgentResult['protocol'], errorCode?: string,
): UrgentAgentResult {
  const plans = status === 'candidates_ready' ? validatedCandidates(progress) : [];
  return {
    eventId, sourceSnapshotId: progress.context?.schedule.snapshotId,
    sourceContextFingerprint: progress.context ? planningContextFingerprint(progress.context) : undefined,
    status, plans, comparisonReady: new Set(plans.map((plan) => plan.profile)).size === 2,
    trace, errorCode, modelCalls, protocol,
  };
}
