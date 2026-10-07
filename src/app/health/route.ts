import { NextResponse } from 'next/server';
import { getDatabase } from '../../db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const optimizerUrl = process.env.OPTIMIZER_URL ?? 'http://localhost:8081';
  let optimizer: { ok: boolean; detail?: string } = { ok: false };
  try {
    const res = await fetch(`${optimizerUrl}/health`, { cache: 'no-store' });
    optimizer = { ok: res.ok };
  } catch (error) {
    optimizer = { ok: false, detail: error instanceof Error ? error.message : 'unreachable' };
  }

  // A real read, so a Postgres that is down or unmigrated shows here, not on the desk.
  let databaseOk = false;
  let boardVersion: number | undefined;
  let databaseDetail: string | undefined;
  try {
    boardVersion = await getDatabase().boardSnapshots.getLatestVersion();
    databaseOk = boardVersion > 0;
  } catch (error) {
    databaseDetail = error instanceof Error ? error.message : 'unreachable';
  }

  return NextResponse.json({
    ok: databaseOk,
    app: 'dispatch-coordinator',
    database: process.env.USE_MEMORY_DB === 'false' ? 'postgres' : 'memory',
    databaseOk,
    boardVersion,
    ...(databaseDetail ? { databaseDetail } : {}),
    optimizer,
    gatewayConfigured: Boolean(process.env.LLM_GATEWAY_URL && process.env.LLM_GATEWAY_API_KEY),
  });
}
