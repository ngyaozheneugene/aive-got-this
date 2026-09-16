import { AgentError } from '../runtime/errors';
import { urgentToolCallSchema } from './protocol';
import type { UrgentToolCall } from './protocol';

/** Advertised schemas mirror frozen contracts; the Zod dispatcher remains authoritative. */
const DEFINITIONS = [
  { type: 'function', function: {
    name: 'retrieve_board', description: 'Read the current board and urgent event. No writes.',
    parameters: { type: 'object', properties: { snapshotId: { type: 'string' } },
      additionalProperties: false },
  } },
  { type: 'function', function: {
    name: 'propose', description: 'Generate scheduler-owned candidates for ONE allowed profile. No writes.',
    parameters: { type: 'object', properties: {
      eventId: { type: 'string' },
      profile: { type: 'string', enum: ['sla_first', 'minimal_disruption'] },
    }, required: ['eventId', 'profile'], additionalProperties: false },
  } },
  { type: 'function', function: {
    name: 'validate', description: 'Independently validate ONE candidate by its allowed plan ID. No writes.',
    parameters: { type: 'object', properties: { planId: { type: 'string' } },
      required: ['planId'], additionalProperties: false },
  } },
];

/** Advertise only tool names in the legal frontier; the graph also checks exact arguments. */
export function nativeToolsForCalls(allowedCalls?: readonly UrgentToolCall[]): Record<string, unknown>[] {
  if (allowedCalls === undefined) return structuredClone(DEFINITIONS);
  if (!allowedCalls.length) throw new AgentError('EMPTY_TOOL_FRONTIER');
  const names = new Set<string>();
  for (const choice of allowedCalls) {
    const parsed = urgentToolCallSchema.safeParse(choice);
    if (!parsed.success) throw new AgentError('INVALID_TOOL_FRONTIER');
    names.add(parsed.data.tool);
  }
  return structuredClone(DEFINITIONS.filter((definition) => names.has(definition.function.name)));
}

/** Never repair text into native calls, select the first of parallel calls, or execute prose. */
export function parseNativeToolCall(reply: {
  tool_calls?: readonly { function: { name: string; arguments?: unknown } }[];
}): UrgentToolCall {
  if (!reply.tool_calls?.length) throw new AgentError('NATIVE_TOOLS_NOT_RETURNED');
  if (reply.tool_calls.length !== 1) throw new AgentError('MULTIPLE_NATIVE_TOOL_CALLS');
  const call = reply.tool_calls[0]!.function;
  // Do not strip keys from arguments before .strict() gets to reject them.
  const parsed = urgentToolCallSchema.safeParse({ tool: call.name, args: call.arguments });
  if (!parsed.success) throw new AgentError('INVALID_NATIVE_TOOL_CALL');
  return parsed.data;
}
