import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkJobs } from '../../dispatch/job-import-check';
import { decodeRosterFile, parseCsv } from '../../dispatch/roster-file';
import { buildScenario } from '../../shared/fixtures/scenario';
import { GATEWAY_MAX_REQUEST_BYTES, type GatewayMessage } from '../runtime/gateway';
import type { ImportChat } from './import-core';
import { JOB_BATCH, readJobs } from './job-reader';

const TYPES = buildScenario('2026-10-20').jobTypes.map((t) => ({ id: t.id, name: t.name, defaultMinutes: t.defaultMinutes }));
const context = { today: '2026-10-20', jobTypes: TYPES, booked: [] as string[] };
const read = async (f: string, chat?: ImportChat) => {
  const r = await readJobs(await decodeRosterFile(readFileSync(`sample-imports/${f}`), f), TYPES, chat);
  return { ...r, rows: checkJobs(r.rows, context) };
};

function scripted(answer: (records: Array<{ id: string; text: string }>) => unknown[] | 'fail') {
  const seen: Array<{ messages: GatewayMessage[]; tools: Record<string, unknown>[] }> = [];
  const chat: ImportChat = async (messages, _signal, tools) => {
    seen.push({ messages, tools });
    const records = (JSON.parse(messages[1]!.content.replace(/^UNTRUSTED_DATA /, '')) as { records: Array<{ id: string; text: string }> }).records;
    const jobs = answer(records);
    if (jobs === 'fail') throw new Error('gateway down');
    return { content: '', tool_calls: [{ function: { name: 'submit_jobs', arguments: { jobs } } }] };
  };
  return { chat, seen };
}
const requestBytes = (m: GatewayMessage[], tools: Record<string, unknown>[]) =>
  Buffer.byteLength(JSON.stringify({ model: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0', messages: m, stream: false, options: { temperature: 0, num_predict: 500 }, tools }));

const MESSY: Record<string, object> = {
  'Far East Medical': { phone: '65 9188 2345', postal: '307506', address: '10 Sinaran Dr', unit: '#08-14', type: 'WATER_LEAK', priority: 'urgent', start: '08:30', end: '11:30', issue: 'Severe water dripping onto ultrasound machine' },
  'Uncle Teo (Bedok)': { phone: '+65 8299-1122', postal: '460218', address: 'Blk 218 Bedok North St 1', unit: '#05-18', type: 'GAS_TOPUP', priority: 'urgent', start: '14:00', end: '17:00' },
  'Desmond Goh': { phone: '96554321', postal: '520245', address: 'Tampines Street 21, Block 245', type: 'GENERAL_SERVICE', priority: 'on_demand', start: '10:00', end: '12:30' },
  'Bukit Merah Cold Storage': { phone: '+65-9711-8899', postal: '150123', address: 'Bukit Merah View', unit: '#01-105', type: 'CRITICAL_HVAC_ELECTRICAL', priority: 'urgent', start: '09:00', end: '12:00' },
  'Punggol Waterway Condo': { phone: '8122-3344', postal: '828288', address: 'Punggol Field Blk 288', unit: '#14-22', type: 'CHEMICAL_WASH', priority: 'when_available', start: '14:00', end: '17:00' },
};
const honest = (records: Array<{ id: string; text: string }>) =>
  records.flatMap((r) => Object.entries(MESSY).filter(([n]) => r.text.includes(n)).map(([customer, rest]) => ({ id: r.id, customer, ...rest })));

describe('job import: the template, read by code', () => {
  it('reads CSV, Excel and Parquet the same way, Excel times and the dropped zero included', async () => {
    for (const f of ['jobs_perfect.csv', 'jobs_perfect.xlsx', 'jobs_perfect.parquet']) {
      const { rows } = await read(f);
      expect(rows.map((r) => [r.customerName, r.postalCode, r.jobTypeId, r.priority, r.windowStart, r.windowEnd, r.readBy, r.isValid])).toEqual([
        ['Raffles Place Capital', '048616', 'WATER_LEAK', 'urgent', '09:00', '12:00', 'template', true],
        ['Tan Household (Simei)', '520123', 'GENERAL_SERVICE', 'on_demand', '14:00', '16:30', 'template', true],
        ['Jurong Gateway Offices', '608549', 'CRITICAL_HVAC_ELECTRICAL', 'urgent', '08:30', '11:30', 'template', true],
        ['Causeway Point Clinic', '738099', 'GAS_TOPUP', 'on_demand', '13:00', '15:30', 'template', true],
        ['Bishan Park Condo MCST', '570123', 'CHEMICAL_WASH', 'when_available', '10:00', '13:00', 'template', true],
      ]);
    }
  });

  it('leaves unknown types, priorities and short windows for the coordinator', async () => {
    const r = await readJobs(parseCsv('customerName,phone,postalCode,address,jobTypeId,priority,windowStart,windowEnd\nAh Kow,91234567,520123,Simei St 1,DUCT_SWEEP,sometime,09:00,09:30'), TYPES);
    const [row] = checkJobs(r.rows, context);
    expect(row).toMatchObject({ jobTypeId: null, priority: null, isValid: false });
    expect(row!.issues).toEqual(expect.arrayContaining(['Choose the kind of job.', 'Choose a priority.']));
  });
});

describe('job import: other layouts, read by the assistant', () => {
  it('reads the messy list a few rows per request, each within the gateway limit, with our job types offered', async () => {
    const m = scripted(honest);
    const { rows, assistantUnavailable } = await read('jobs_messy.xlsx', m.chat);
    expect(m.seen).toHaveLength(Math.ceil(5 / JOB_BATCH));
    for (const call of m.seen) expect(requestBytes(call.messages, call.tools)).toBeLessThan(GATEWAY_MAX_REQUEST_BYTES);
    expect(m.seen[0]!.messages[0]!.content).toContain('WATER_LEAK (Water Leakage Repair)');
    expect(assistantUnavailable).toBe(false);
    expect(rows.every((r) => r.readBy === 'assistant' && r.isValid)).toBe(true);
    expect(rows[1]).toMatchObject({ customerName: 'Uncle Teo (Bedok)', phone: '+65 8299-1122', windowStart: '14:00', windowEnd: '17:00' });
  });

  it('keeps only what the row bears out', async () => {
    const m = scripted((records) => records.map((r) => ({ id: r.id, customer: 'Someone Else', phone: '90001111', postal: '520001', address: 'Orchard Road', type: 'WATER_LEAK', priority: 'urgent', start: '19:00', end: '21:00' })));
    const { rows } = await read('jobs_messy.csv', m.chat);
    expect(rows[0]).toMatchObject({ customerName: '', phone: '', postalCode: '', address: '', windowStart: null, windowEnd: null, isValid: false });
    expect(rows[0]!.notices).toEqual(expect.arrayContaining([
      'The assistant read the customer as "Someone Else", which is not in the row; left blank.',
      'The assistant read the postal code as "520001", which is not in the row; left blank.',
      'The assistant read a time as 19:00, which is not in the row; left blank.',
    ]));
  });

  it('reads the type from the row when the assistant offers one we do not have', async () => {
    const m = scripted((records) => honest(records).map((j) => ({ ...j, type: 'PLUMBING' })));
    const { rows } = await read('jobs_messy.csv', m.chat);
    expect(rows.map((r) => r.jobTypeId)).toEqual(['WATER_LEAK', 'GAS_TOPUP', 'GENERAL_SERVICE', 'CRITICAL_HVAC_ELECTRICAL', 'CHEMICAL_WASH']);
  });

  it('falls back to keyword matching when the gateway keeps failing, and still reads the messy list', async () => {
    const m = scripted(() => 'fail');
    const { rows, assistantUnavailable } = await read('jobs_messy.csv', m.chat);
    expect(assistantUnavailable).toBe(true);
    expect(rows.every((r) => r.readBy === 'keywords' && r.isValid)).toBe(true);
    expect(rows.map((r) => [r.jobTypeId, r.priority, r.windowStart, r.windowEnd])).toEqual([
      ['WATER_LEAK', 'urgent', '08:30', '11:30'],
      ['GAS_TOPUP', 'urgent', '14:00', '17:00'],
      ['GENERAL_SERVICE', 'on_demand', '10:00', '12:30'],
      ['CRITICAL_HVAC_ELECTRICAL', 'urgent', '09:00', '12:00'],
      ['CHEMICAL_WASH', 'when_available', '14:00', '17:00'],
    ]);
  });
});

describe('job import: nothing confident from a scrambled file', () => {
  it('backwards and empty windows, impossible postal codes and fake numbers all stay issues', async () => {
    for (const f of ['jobs_scrambled.csv', 'jobs_scrambled.xlsx', 'jobs_scrambled.parquet']) {
      const { rows } = await read(f);
      expect(rows).toHaveLength(5);
      expect(rows.filter((r) => r.isValid)).toHaveLength(0);
      expect(rows.every((r) => r.windowStart === null)).toBe(true);
    }
  });
});

describe('checkJobs', () => {
  it('flags a booking already on the board or repeated in the file', async () => {
    const r = await readJobs(parseCsv('customerName,phone,postalCode,address,jobTypeId,priority,windowStart,windowEnd\nA,91234567,520123,Simei St 1,GENERAL_SERVICE,on_demand,14:00,16:30\nB,+65 9123 4567,520123,Simei St 1,GENERAL_SERVICE,on_demand,14:00,16:30'), TYPES);
    expect(checkJobs(r.rows, context).map((x) => x.issues)).toEqual([[], ['Same booking as row 2.']]);
    expect(checkJobs(r.rows, { ...context, booked: ['91234567|520123|GENERAL_SERVICE|2026-10-20|14:00'] })[0]!.issues).toEqual(['Already booked: same customer, place, job and time.']);
  });
});
