// Shared reading for file imports: technician rosters (ADR 012) and job
// lists (ADR 013).
//
// A file arrives as a grid of text cells. It is split into sections at blank
// rows; a section is either a table (a header row, one item per row) or blocks
// (a marker row such as "[Technician: Siti]" followed by one fact per row).
// Tables in the import's standard template are read by code. Everything else
// goes to the assistant a few records at a time, so every request fits the
// gateway, and the import's own check compares what comes back with the
// record it came from. A reply that is cut off or unusable is split and
// retried; a record the assistant leaves out is asked about once on its own,
// then listed as skipped. When the gateway is not configured or keeps
// failing, records are read by the import's keyword reader, labelled as such.

import { z } from 'zod';
import type { GatewayMessage } from '../runtime/gateway';
import type { Grid } from '../../dispatch/roster-file';

export type ImportChat = (
  messages: GatewayMessage[],
  signal: AbortSignal | undefined,
  tools: Record<string, unknown>[],
) => Promise<{ content: string; tool_calls?: Array<{ function: { name: string; arguments?: unknown } }> }>;

export interface ImportRecord {
  sourceRow: number;
  /** "Header: value | Header: value", or the block's lines joined. */
  text: string;
  /** Table records: the cells under their headers, for keyword reading. */
  cells?: Array<{ header: string; value: string }>;
}

export interface Reading<T> {
  rows: T[];
  skipped: Array<{ sourceRow: number; reason: string }>;
  assistantUnavailable: boolean;
}

export type GridRow = { n: number; cells: string[] };

/** Characters of one record sent to the assistant. */
const RECORD_CHARS = 400;
const CONCURRENT_REQUESTS = 3;

// ----------------------------------------------------------------- helpers

export const clean = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');
export const filled = (row: string[]) => row.filter((c) => c !== '');
export const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Standalone 6-digit numbers: not part of a phone number or a longer id. */
export const sixDigits = (text: string) => [...text.matchAll(/(?<![\d])(\d{6})(?![\d])/g)].map((m) => m[1]!);

/**
 * A postal code as the record states it. Spreadsheets drop the leading zero
 * of CBD codes (048581 becomes 48581), so a 5-digit value in a postal column
 * gets it back, with a note.
 */
export function postalFrom(raw: string, notices: string[]): string {
  const v = raw.trim();
  if (/^\d{6}$/.test(v)) return v;
  if (/^\d{5}$/.test(v)) {
    notices.push(`Postal code ${v} read as 0${v}: spreadsheets drop the leading zero.`);
    return `0${v}`;
  }
  return v;
}

/** A postal code the assistant returned, kept only if the record states it (or states it without the leading zero). */
export function groundedPostal(postal: string, record: ImportRecord, notices: string[]): string {
  const p = postal.replace(/\s/g, '');
  if (!p || sixDigits(record.text).includes(p)) return p;
  const five = /^0(\d{5})$/.exec(p)?.[1];
  if (five && new RegExp(`(?<!\\d)${five}(?!\\d)`).test(record.text)) {
    notices.push(`Postal code ${five} read as ${p}: spreadsheets drop the leading zero.`);
    return p;
  }
  notices.push(`The assistant read the postal code as "${p}", which is not in the row; left blank.`);
  return '';
}

/** Headers compared as words: "can_do_ot" and "Can do OT?" both say OT. */
export const cellOf = (r: ImportRecord, re: RegExp) => r.cells?.find((c) => re.test(c.header.replace(/[_\W]+/g, ' ')))?.value;
/** "Label: value" inside a block record. */
export const labelledIn = (r: ImportRecord, re: RegExp) => new RegExp(`(?:${re.source})\\s*:\\s*([^|]+)`, 'i').exec(r.text)?.[1]?.trim();

export function escapedJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

// ---------------------------------------------------------- grid to records

/** Runs of non-blank rows, with the file row number of each row. */
function sections(grid: Grid): GridRow[][] {
  const out: GridRow[][] = [];
  let current: GridRow[] = [];
  grid.forEach((cells, i) => {
    if (filled(cells).length === 0) {
      if (current.length) out.push(current);
      current = [];
    } else current.push({ n: i + 1, cells });
  });
  if (current.length) out.push(current);
  return out;
}

/** Mostly one value per row: a block layout, not a table. */
const isBlocks = (rows: GridRow[]) => rows.filter((r) => filled(r.cells).length <= 1).length >= rows.length * 0.6;

function tableRecords(header: string[], rows: GridRow[]): ImportRecord[] {
  return rows.map(({ n, cells }) => {
    const pairs = cells.map((value, i) => ({ header: header[i] || `Column ${i + 1}`, value })).filter((p) => p.value !== '');
    return { sourceRow: n, text: pairs.map((p) => `${p.header}: ${p.value}`).join(' | '), cells: pairs };
  });
}

function blockRecords(rows: GridRow[], blockStart: RegExp): ImportRecord[] {
  const starts = rows.map((r, i) => (blockStart.test(filled(r.cells)[0] ?? '') ? i : -1)).filter((i) => i >= 0);
  // No markers: each line is one item.
  if (!starts.length) return rows.map((r) => ({ sourceRow: r.n, text: filled(r.cells).join(' | ') }));
  return starts.map((start, k) => {
    const lines = rows.slice(start, starts[k + 1] ?? rows.length);
    return { sourceRow: lines[0]!.n, text: lines.map((l) => filled(l.cells).join(' | ')).join(' | ') };
  });
}

/** Template tables to read by code, and every other record for the assistant. */
export function splitGrid(grid: Grid, opts: { blockStart: RegExp; isTemplate: (header: string[]) => boolean }) {
  const templates: Array<{ header: string[]; rows: GridRow[] }> = [];
  const records: ImportRecord[] = [];
  for (const section of sections(grid)) {
    if (isBlocks(section)) {
      records.push(...blockRecords(section, opts.blockStart));
      continue;
    }
    const [header, ...body] = section;
    if (!body.length) continue;
    if (opts.isTemplate(header!.cells)) templates.push({ header: header!.cells, rows: body });
    else records.push(...tableRecords(header!.cells, body));
  }
  return { templates, records };
}

// -------------------------------------------------------- assistant reading

export interface AssistantSpec<P extends { id: string }, T> {
  /** What one item is, for messages: "technician", "job". */
  noun: string;
  system: string;
  tool: { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };
  /** The tool's array of items. */
  listKey: string;
  item: z.ZodType<P>;
  /** Records per request, sized so the 500-token reply holds them all. */
  batch: number;
  /** Records the assistant reads per file; the rest go to keywords. */
  maxRecords: number;
  /** The assistant's reading of one record, kept only where the record bears it out. */
  check: (record: ImportRecord, item: P) => T;
  /** Reading without the assistant. `why` is the first notice. */
  keywords: (record: ImportRecord, why: string) => T;
}

async function inPool<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await run(items[next++]!);
  }));
}

/** One request. Null when the assistant gave nothing usable. */
async function readBatch<P extends { id: string }, T>(batch: ImportRecord[], spec: AssistantSpec<P, T>, chat: ImportChat, signal?: AbortSignal) {
  const ids = new Map(batch.map((r, i) => [`r${i + 1}`, r]));
  const records = [...ids].map(([id, r]) => ({ id, text: r.text.length > RECORD_CHARS ? `${r.text.slice(0, RECORD_CHARS)}…` : r.text }));
  const messages: GatewayMessage[] = [
    { role: 'system', content: spec.system },
    { role: 'user', content: `UNTRUSTED_DATA ${escapedJson({ records })}` },
  ];
  const reply = await chat(messages, signal, [spec.tool]);
  const call = reply.tool_calls?.length === 1 ? reply.tool_calls[0] : undefined;
  if (call?.function.name !== spec.tool.function.name) return null;
  const args = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments;
  const list = (args as Record<string, unknown> | undefined)?.[spec.listKey];
  if (!Array.isArray(list) || list.length > batch.length * 2) return null;

  const read = new Map<ImportRecord, T>();
  for (const raw of list) {
    const p = spec.item.safeParse(raw);
    const r = p.success ? ids.get(p.data.id) : undefined;
    if (r && p.success && !read.has(r)) read.set(r, spec.check(r, p.data));
  }
  return read;
}

/** Read records with the assistant where possible, keywords where not. Rows come back in file order. */
export async function readRecords<P extends { id: string }, T extends { sourceRow: number }>(
  records: ImportRecord[],
  spec: AssistantSpec<P, T>,
  chat?: ImportChat,
  signal?: AbortSignal,
): Promise<Reading<T>> {
  const rows: T[] = [];
  const skipped: Reading<T>['skipped'] = [];
  let assistantUnavailable = !chat && records.length > 0;

  const forAssistant = chat ? records.slice(0, spec.maxRecords) : [];
  for (const r of records.slice(forAssistant.length)) {
    rows.push(spec.keywords(r, chat
      ? `Read by keyword matching: past the ${spec.maxRecords} rows the assistant reads. Check each field.`
      : 'Read by keyword matching: the assistant is not set up. Check each field.'));
  }

  const notFound = `The assistant did not find a ${spec.noun} in this row.`;
  /**
   * Read a batch; when the reply is unusable, split it and try the halves. A
   * record the assistant leaves out is asked about once on its own before it
   * is listed as skipped: a live run dropped one of four.
   */
  const readSome = async (batch: ImportRecord[], retryMissing: boolean): Promise<void> => {
    let read: Map<ImportRecord, T> | null = null;
    try {
      read = await readBatch(batch, spec, chat!, signal);
    } catch {
      read = null;
    }
    if (!read && batch.length > 1) {
      const half = Math.ceil(batch.length / 2);
      await Promise.all([readSome(batch.slice(0, half), retryMissing), readSome(batch.slice(half), retryMissing)]);
      return;
    }
    if (!read) {
      assistantUnavailable = true;
      for (const r of batch) rows.push(spec.keywords(r, 'Read by keyword matching: the assistant could not read this row. Check each field.'));
      return;
    }
    const missing: ImportRecord[] = [];
    for (const r of batch) {
      const row = read.get(r);
      if (row) rows.push(row);
      else if (retryMissing && batch.length > 1) missing.push(r);
      else skipped.push({ sourceRow: r.sourceRow, reason: notFound });
    }
    await Promise.all(missing.map((r) => readSome([r], false)));
  };

  const batches: ImportRecord[][] = [];
  for (let i = 0; i < forAssistant.length; i += spec.batch) batches.push(forAssistant.slice(i, i + spec.batch));
  await inPool(batches, CONCURRENT_REQUESTS, (batch) => readSome(batch, true));

  rows.sort((a, b) => a.sourceRow - b.sourceRow);
  skipped.sort((a, b) => a.sourceRow - b.sourceRow);
  return { rows, skipped, assistantUnavailable };
}

/** Cap the rows, listing the rest as skipped. */
export function capRows<T extends { sourceRow: number }>(reading: Reading<T>, max: number, noun: string): Reading<T> {
  if (reading.rows.length <= max) return reading;
  const over = reading.rows.slice(max).map((r) => ({ sourceRow: r.sourceRow, reason: `Only ${max} ${noun}s can be added at once.` }));
  return { ...reading, rows: reading.rows.slice(0, max), skipped: [...reading.skipped, ...over].sort((a, b) => a.sourceRow - b.sourceRow) };
}
