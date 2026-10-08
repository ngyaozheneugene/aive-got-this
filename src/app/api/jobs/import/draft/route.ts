import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDatabase } from '../../../../../db';
import { workspaceOf } from '../../../_lib/workspace';
import { readJobs, readJobsFromParquet, type KnownJobTypeInfo } from '../../../../../agent/reports/job-reader';
import { createGatewayClient, readGatewayConfig, type GatewayMessage } from '../../../../../agent/runtime/gateway';
import type { ReportChat } from '../../../../../agent/reports/roster-reader';
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

/** Parse an uploaded jobs batch (CSV, text, or Parquet) into candidate work orders for preview/confirmation. */
export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return badRequest('invalid_json');
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return badRequest('invalid_jobs_payload', parsed.error.flatten());
  }

  const db = getDatabase(workspaceOf(request));
  let knownTypes: KnownJobTypeInfo[] | undefined;
  try {
    const rawTypes = await db.jobTypes.listAll();
    knownTypes = rawTypes.map((t) => ({ id: t.id, name: t.name, defaultMinutes: t.defaultMinutes }));
  } catch {
    knownTypes = undefined;
  }

  let chat: ReportChat | undefined;
  try {
    const gateway = createGatewayClient(readGatewayConfig());
    chat = (messages: GatewayMessage[], signal?: AbortSignal, tools?: Record<string, unknown>[]) =>
      gateway.chat(messages, signal, tools);
  } catch {
    chat = undefined;
  }

  if ('fileBase64' in parsed.data) {
    const buffer = Buffer.from(parsed.data.fileBase64, 'base64');
    const isParquet =
      parsed.data.filename?.toLowerCase().endsWith('.parquet') ||
      buffer.subarray(0, 4).toString('utf-8') === 'PAR1';

    if (isParquet) {
      const result = await readJobsFromParquet(buffer, chat, request.signal, knownTypes);
      return NextResponse.json(result);
    }

    const text = buffer.toString('utf-8');
    const result = await readJobs(text, chat, request.signal, knownTypes);
    return NextResponse.json(result);
  }

  const result = await readJobs(parsed.data.text, chat, request.signal, knownTypes);
  return NextResponse.json(result);
}
