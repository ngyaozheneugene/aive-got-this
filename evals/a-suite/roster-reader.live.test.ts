/**
 * A-11 (live): roster files read by the real model through the organiser
 * gateway (ADR 012). Opt-in, like the other gateway smokes:
 *
 *   RUN_ROSTER_LIVE=1 npx vitest run evals/a-suite/roster-reader.live.test.ts
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createGatewayClient, readGatewayConfig } from '../../src/agent/runtime/gateway';
import { readRoster } from '../../src/agent/reports/roster-reader';
import { checkRoster } from '../../src/dispatch/roster-check';
import { decodeRosterFile } from '../../src/dispatch/roster-file';

const enabled = process.env.RUN_ROSTER_LIVE === '1';
vi.setConfig({ testTimeout: 180_000 });

function gatewayEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  if (env.LLM_GATEWAY_API_KEY) return env;
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = /^(LLM_GATEWAY_URL|LLM_GATEWAY_API_KEY|LLM_MODEL)=(.*)$/.exec(line.trim());
      if (m) env[m[1]!] = m[2]!.trim();
    }
  } catch {
    // No .env.local: readGatewayConfig reports the missing configuration.
  }
  return env;
}

async function read(file: string) {
  const { chat } = createGatewayClient(readGatewayConfig(gatewayEnv()));
  const reading = await readRoster(await decodeRosterFile(readFileSync(`sample-imports/${file}`), file), (m, s, t) => chat(m, s, t));
  const rows = checkRoster(reading.rows, []);
  console.log(JSON.stringify({ file, assistantUnavailable: reading.assistantUnavailable, skipped: reading.skipped, rows: rows.map((r) => ({ row: r.sourceRow, by: r.readBy, name: r.name, tier: r.tier, postal: r.homePostalCode, certs: r.certs, parts: r.parts, minutes: r.maxMinutesDay, ot: r.acceptsOt, valid: r.isValid, issues: r.issues, notices: r.notices })) }));
  return { ...reading, rows };
}

describe.skipIf(!enabled)('A-11 roster import, live model', () => {
  it('reads the messy spreadsheet', async () => {
    const { rows, assistantUnavailable } = await read('technicians_messy.xlsx');
    expect(assistantUnavailable).toBe(false);
    expect(rows.every((r) => r.readBy === 'assistant')).toBe(true);
    expect(rows.find((r) => r.name === 'Ah Seng')).toMatchObject({ tier: 3, homePostalCode: '640512', maxMinutesDay: 510, acceptsOt: true });
    expect(rows.find((r) => r.name === 'Venkatesh K')).toMatchObject({ tier: 4, homePostalCode: '730312' });
    expect(rows.find((r) => r.name === 'Venkatesh K')!.certs.map((c) => c.type).sort()).toEqual(['EMA_LEW', 'NEA_R32']);
  });

  it('reads blocks and a table from one sheet', async () => {
    const { rows } = await read('technicians_mixed.xlsx');
    expect(rows.map((r) => r.name)).toEqual(['Siti Ahmad', 'Nathan Tan', 'Muhammad Hafiz', 'Ah Seng', 'Nurul Izzah', 'Dave Lim', 'Venkatesh K', 'Marcus Chen']);
    expect(rows.find((r) => r.name === 'Nathan Tan')).toMatchObject({ tier: 1, homePostalCode: '048624', maxMinutesDay: 450, acceptsOt: false });
  });

  it('does not turn a scrambled file into confident rows', async () => {
    const { rows } = await read('technicians_scrambled.parquet');
    // Whatever it finds, nothing out of range survives the checks.
    for (const r of rows) {
      expect(r.tier === null || [1, 2, 3, 4].includes(r.tier)).toBe(true);
      expect(r.maxMinutesDay === null || (r.maxMinutesDay >= 120 && r.maxMinutesDay <= 720)).toBe(true);
    }
    expect(rows.some((r) => r.homePostalCode === '999999' && r.isValid)).toBe(false);
  });
});
