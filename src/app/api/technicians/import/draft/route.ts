import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDatabase } from '../../../../../db';
import { readRoster, type RosterChat } from '../../../../../agent/reports/roster-reader';
import { createGatewayClient, readGatewayConfig } from '../../../../../agent/runtime/gateway';
import { checkRoster } from '../../../../../dispatch/roster-check';
import { decodeRosterFile, MAX_ROSTER_FILE_BYTES, parseCsv, RosterFileError } from '../../../../../dispatch/roster-file';
import type { ParseRosterResponse } from '../../../../../shared/contracts/technicians';
import { badRequest, fail } from '../../../_lib/http';
import { workspaceOf } from '../../../_lib/workspace';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Base64 is 4/3 the size of the file.
const MAX_BASE64 = Math.ceil((MAX_ROSTER_FILE_BYTES * 4) / 3) + 4;

const bodySchema = z.union([
  z.object({ text: z.string().trim().min(1).max(200_000) }).strict(),
  z.object({ fileBase64: z.string().min(1).max(MAX_BASE64), filename: z.string().max(200).optional() }).strict(),
]);

/**
 * Read a roster file into rows for the coordinator to check. Writes nothing:
 * the confirmed rows go to POST /api/technicians/bulk. ADR 012.
 */
export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return badRequest('invalid_json');
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return fail('invalid_roster_upload', 400, 'Send a CSV, Excel (.xlsx) or Parquet file of up to 2 MB.');
  }

  let grid;
  try {
    grid = 'text' in parsed.data
      ? parseCsv(parsed.data.text)
      : await decodeRosterFile(Buffer.from(parsed.data.fileBase64, 'base64'), parsed.data.filename);
  } catch (e) {
    if (e instanceof RosterFileError) return fail(e.code, 422, e.detail);
    throw e;
  }

  let chat: RosterChat | undefined;
  try {
    const gateway = createGatewayClient(readGatewayConfig());
    chat = (messages, signal, tools) => gateway.chat(messages, signal, tools);
  } catch {
    // Not configured: the reader falls back to keyword matching and says so on every row.
  }

  const db = getDatabase(workspaceOf(request));
  const [reading, team] = await Promise.all([readRoster(grid, chat, request.signal), db.technicians.listAll()]);
  const teamNames = team.map((t) => t.name);
  const candidates = checkRoster(reading.rows, teamNames);
  const body: ParseRosterResponse = {
    candidates,
    skipped: reading.skipped,
    teamNames,
    assistantUnavailable: reading.assistantUnavailable,
    totalRows: candidates.length,
    validCount: candidates.filter((c) => c.isValid).length,
  };
  return NextResponse.json(body);
}
