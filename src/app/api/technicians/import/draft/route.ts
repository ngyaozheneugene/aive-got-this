import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readRoster, type ReportChat } from '../../../../../agent/reports/roster-reader';
import { createGatewayClient, readGatewayConfig, type GatewayMessage } from '../../../../../agent/runtime/gateway';
import { badRequest } from '../../../_lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  text: z.string().trim().min(1).max(50_000),
});

/** Parse an uploaded roster (CSV or text) into candidate technicians for preview/confirmation. */
export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return badRequest('invalid_json');
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return badRequest('invalid_roster_payload', parsed.error.flatten());
  }

  let chat: ReportChat | undefined;
  try {
    const gateway = createGatewayClient(readGatewayConfig());
    chat = (messages: GatewayMessage[], signal?: AbortSignal, tools?: Record<string, unknown>[]) =>
      gateway.chat(messages, signal, tools);
  } catch {
    // Gateway not configured or offline: readRoster will use fast path or heuristic fallback
    chat = undefined;
  }

  const result = await readRoster(parsed.data.text, chat, request.signal);
  return NextResponse.json(result);
}
