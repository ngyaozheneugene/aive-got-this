import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDatabase } from '../../../../db';
import { readReport, MAX_REPORT_CHARS } from '../../../../agent/reports/reader';
import { createGatewayClient, readGatewayConfig } from '../../../../agent/runtime/gateway';
import { AgentError } from '../../../../agent/runtime/errors';
import { badRequest, fail } from '../../_lib/http';
import { workspaceOf } from '../../_lib/workspace';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ text: z.string().trim().min(1).max(MAX_REPORT_CHARS) }).strict();

/**
 * Read a typed report into ONE draft for the coordinator to confirm. Writes
 * nothing: confirming runs the desk's own paths. ADR 009.
 */
export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return badRequest('invalid_json');
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return badRequest('invalid_report', parsed.error.flatten());

  try {
    const { chat } = createGatewayClient(readGatewayConfig());
    const result = await readReport(
      getDatabase(workspaceOf(request)),
      parsed.data.text,
      (messages, signal, tools) => chat(messages, signal, tools),
      request.signal,
    );
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof AgentError ? error.code : 'REPORT_FAILED';
    if (code === 'GATEWAY_CONFIG_MISSING' || code === 'GATEWAY_CONFIG_INVALID') {
      return fail('gateway_not_configured', 503, 'The assistant is not set up on this server. Use the controls on the board instead.');
    }
    if (code.startsWith('GATEWAY_HTTP_4') && code !== 'GATEWAY_HTTP_408' && code !== 'GATEWAY_HTTP_429') {
      return fail('gateway_rejected', 502, 'The assistant refused the request. Use the controls on the board instead.');
    }
    if (code === 'GATEWAY_REQUEST_TOO_LARGE') {
      return fail('report_too_complex', 422, 'That report needs too much context to read in one go. Try something shorter.');
    }
    if (code.startsWith('GATEWAY_')) {
      return fail('gateway_unavailable', 503, 'The assistant is unavailable right now. Try again, or use the controls on the board.');
    }
    if (code === 'AGENT_ABORTED') return fail('report_cancelled', 499, 'Cancelled.');
    return fail('report_failed', 500, 'Could not read that report.');
  }
}
