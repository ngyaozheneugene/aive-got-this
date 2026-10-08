/**
 * A-12 (live): job lists read by the real model through the organiser
 * gateway (ADR 013). Opt-in:
 *
 *   RUN_ROSTER_LIVE=1 npx vitest run evals/a-suite/job-reader.live.test.ts
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createGatewayClient, readGatewayConfig } from '../../src/agent/runtime/gateway';
import { readJobs } from '../../src/agent/reports/job-reader';
import { checkJobs } from '../../src/dispatch/job-import-check';
import { decodeRosterFile } from '../../src/dispatch/roster-file';
import { buildScenario } from '../../src/shared/fixtures/scenario';

const enabled = process.env.RUN_ROSTER_LIVE === '1';
vi.setConfig({ testTimeout: 180_000 });
const TYPES = buildScenario('2026-10-20').jobTypes.map((t) => ({ id: t.id, name: t.name, defaultMinutes: t.defaultMinutes }));

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
  const reading = await readJobs(await decodeRosterFile(readFileSync(`sample-imports/${file}`), file), TYPES, (m, s, t) => chat(m, s, t));
  const rows = checkJobs(reading.rows, { today: '2026-10-20', jobTypes: TYPES, booked: [] });
  console.log(JSON.stringify({ file, assistantUnavailable: reading.assistantUnavailable, skipped: reading.skipped, rows: rows.map((r) => ({ row: r.sourceRow, by: r.readBy, customer: r.customerName, phone: r.phone, postal: r.postalCode, address: r.address, unit: r.unitNo, type: r.jobTypeId, priority: r.priority, window: `${r.windowStart}-${r.windowEnd}`, valid: r.isValid, issues: r.issues, notices: r.notices })) }));
  return { ...reading, rows };
}

describe.skipIf(!enabled)('A-12 job import, live model', () => {
  it('reads the messy work orders', async () => {
    const { rows, assistantUnavailable } = await read('jobs_messy.xlsx');
    expect(assistantUnavailable).toBe(false);
    expect(rows.every((r) => r.readBy === 'assistant')).toBe(true);
    expect(rows.map((r) => [r.postalCode, r.jobTypeId, r.windowStart, r.windowEnd])).toEqual([
      ['307506', 'WATER_LEAK', '08:30', '11:30'],
      ['460218', 'GAS_TOPUP', '14:00', '17:00'],
      ['520245', 'GENERAL_SERVICE', '10:00', '12:30'],
      ['150123', 'CRITICAL_HVAC_ELECTRICAL', '09:00', '12:00'],
      ['828288', 'CHEMICAL_WASH', '14:00', '17:00'],
    ]);
    expect(rows.filter((r) => r.priority === 'urgent').length).toBeGreaterThanOrEqual(3);
  });

  it('books nothing from the scrambled export', async () => {
    const { rows } = await read('jobs_scrambled.xlsx');
    expect(rows.filter((r) => r.isValid)).toHaveLength(0);
  });
});
