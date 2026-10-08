import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDatabase } from '../../../../../db';
import { readJobs } from '../../../../../agent/reports/job-reader';
import type { ImportChat } from '../../../../../agent/reports/import-core';
import { createGatewayClient, readGatewayConfig } from '../../../../../agent/runtime/gateway';
import { boardDate } from '../../../../../dispatch/board-date';
import { bookedKeys } from '../../../../../dispatch/create-job';
import { checkJobs } from '../../../../../dispatch/job-import-check';
import { decodeRosterFile, MAX_ROSTER_FILE_BYTES, parseCsv, RosterFileError } from '../../../../../dispatch/roster-file';
import type { ParseJobsResponse } from '../../../../../shared/contracts/jobs';
import { badRequest, fail } from '../../../_lib/http';
import { workspaceOf } from '../../../_lib/workspace';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_BASE64 = Math.ceil((MAX_ROSTER_FILE_BYTES * 4) / 3) + 4;

const bodySchema = z.union([
  z.object({ text: z.string().trim().min(1).max(200_000) }).strict(),
  z.object({ fileBase64: z.string().min(1).max(MAX_BASE64), filename: z.string().max(200).optional() }).strict(),
]);

/**
 * Read a job list into bookings for the coordinator to check. Writes nothing:
 * the confirmed rows go to POST /api/jobs/bulk. ADR 013.
 */
export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return badRequest('invalid_json');
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return fail('invalid_jobs_upload', 400, 'Send a CSV, Excel (.xlsx) or Parquet file of up to 2 MB.');

  let grid;
  try {
    grid = 'text' in parsed.data
      ? parseCsv(parsed.data.text)
      : await decodeRosterFile(Buffer.from(parsed.data.fileBase64, 'base64'), parsed.data.filename);
  } catch (e) {
    if (e instanceof RosterFileError) return fail(e.code, 422, e.detail);
    throw e;
  }

  let chat: ImportChat | undefined;
  try {
    const gateway = createGatewayClient(readGatewayConfig());
    chat = (messages, signal, tools) => gateway.chat(messages, signal, tools);
  } catch {
    // Not configured: the reader falls back to keyword matching and says so on every row.
  }

  const db = getDatabase(workspaceOf(request));
  const today = await boardDate(db);
  const jobTypes = (await db.jobTypes.listAll()).map((t) => ({ id: t.id, name: t.name, defaultMinutes: t.defaultMinutes }));
  const [reading, booked] = await Promise.all([readJobs(grid, jobTypes, chat, request.signal), bookedKeys(db, today)]);
  const context = { today, jobTypes, booked };
  const candidates = checkJobs(reading.rows, context);
  const body: ParseJobsResponse = {
    candidates,
    skipped: reading.skipped,
    context,
    assistantUnavailable: reading.assistantUnavailable,
    totalRows: candidates.length,
    validCount: candidates.filter((c) => c.isValid).length,
  };
  return NextResponse.json(body);
}
