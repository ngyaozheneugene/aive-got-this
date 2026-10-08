import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readRoster, readRosterFromParquet, type ReportChat } from '../../../../../agent/reports/roster-reader';
import { createGatewayClient, readGatewayConfig, type GatewayMessage } from '../../../../../agent/runtime/gateway';
import { badRequest } from '../../../_lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.union([
  z.object({
    text: z.string().trim().min(1).max(200_000),
  }),
  z.object({
    fileBase64: z.string().min(1),
    filename: z.string().optional(),
  }),
]);

/** Parse an uploaded roster (CSV, text, or Parquet) into candidate technicians for preview/confirmation. */
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

  if ('fileBase64' in parsed.data) {
    const buffer = Buffer.from(parsed.data.fileBase64, 'base64');
    const isParquet =
      parsed.data.filename?.toLowerCase().endsWith('.parquet') ||
      buffer.subarray(0, 4).toString('utf-8') === 'PAR1';

    if (isParquet) {
      const result = await readRosterFromParquet(buffer, chat, request.signal);
      return NextResponse.json(result);
    }

    const text = buffer.toString('utf-8');
    const result = await readRoster(text, chat, request.signal);
    return NextResponse.json(result);
  }

  const result = await readRoster(parsed.data.text, chat, request.signal);
  return NextResponse.json(result);
}
