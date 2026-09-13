import { NextResponse } from 'next/server';

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

  return NextResponse.json({
    ok: true,
    app: 'dispatch-coordinator',
    database: process.env.USE_MEMORY_DB === 'false' ? 'postgres' : 'memory',
    optimizer,
    gatewayConfigured: Boolean(process.env.LLM_GATEWAY_URL && process.env.LLM_GATEWAY_API_KEY),
  });
}
