import { z } from 'zod';
import { retrieveBoardArgsSchema, proposeToolArgsSchema, validateToolArgsSchema } from '../../shared/contracts/tools';
import { AgentError } from '../runtime/errors';

/** G1 has read/planning tools only. No approval, commit, assignment or shell dispatch. */
export const urgentToolCallSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('retrieve_board'), args: retrieveBoardArgsSchema.strict() }).strict(),
  z.object({ tool: z.literal('propose'), args: proposeToolArgsSchema.strict() }).strict(),
  z.object({ tool: z.literal('validate'), args: validateToolArgsSchema.strict() }).strict(),
]);
export type UrgentToolCall = z.infer<typeof urgentToolCallSchema>;

export function parseToolCall(reply: string): UrgentToolCall {
  if (Buffer.byteLength(reply) > 8_192) throw new AgentError('TOOL_RESPONSE_TOO_LARGE');
  let value: unknown;
  try { value = JSON.parse(reply); }
  catch { throw new AgentError('MALFORMED_TOOL_JSON'); }
  const parsed = urgentToolCallSchema.safeParse(value);
  if (!parsed.success) throw new AgentError('INVALID_TOOL_CALL');
  return parsed.data;
}

export function sameToolCall(a: UrgentToolCall, b: UrgentToolCall): boolean {
  // Zod normalizes property order; unknown keys have already been rejected.
  return a.tool === b.tool && JSON.stringify(a.args) === JSON.stringify(b.args);
}
