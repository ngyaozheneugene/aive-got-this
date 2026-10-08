// Turns an uploaded roster file into a grid of trimmed text cells, whatever
// it came as: CSV, Excel (.xlsx) or Parquet. Server only. ADR 012.

/** Uploads larger than this are refused before decoding. */
export const MAX_ROSTER_FILE_BYTES = 2 * 1024 * 1024;

export type Grid = string[][];

export class RosterFileError extends Error {
  constructor(readonly code: string, readonly detail: string) {
    super(code);
  }
}

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map(cellText).join('; ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v).trim();
};

/** RFC 4180 CSV. Quoted cells may hold commas and line breaks. */
export function parseCsv(text: string): Grid {
  const rows: Grid = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endCell = () => {
    row.push(cell.trim());
    cell = '';
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') endCell();
    else if (c === '\n') endRow();
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) endRow();
  return rows;
}

export async function decodeRosterFile(bytes: Uint8Array, filename = ''): Promise<Grid> {
  if (bytes.byteLength > MAX_ROSTER_FILE_BYTES) {
    throw new RosterFileError('file_too_large', 'Roster files are limited to 2 MB.');
  }
  const name = filename.toLowerCase();
  const magic = new TextDecoder().decode(bytes.subarray(0, 4));
  if (name.endsWith('.parquet') || magic === 'PAR1') return parquetGrid(bytes);
  if (name.endsWith('.xlsx') || magic.startsWith('PK')) return xlsxGrid(bytes);
  if (name.endsWith('.xls')) {
    throw new RosterFileError('unsupported_file', 'Old .xls files are not supported. Save it as .xlsx or .csv and try again.');
  }
  return parseCsv(new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, ''));
}

async function xlsxGrid(bytes: Uint8Array): Promise<Grid> {
  const { default: readExcel } = await import('read-excel-file/node');
  try {
    const sheets = await readExcel(Buffer.from(bytes));
    // Every sheet, one after another, with a blank row between them.
    return sheets.flatMap((s, i) => [...(i ? [[] as string[]] : []), ...s.data.map((r) => r.map(cellText))]);
  } catch {
    throw new RosterFileError('unreadable_file', 'This Excel file could not be read.');
  }
}

async function parquetGrid(bytes: Uint8Array): Promise<Grid> {
  const { parquetReadObjects } = await import('hyparquet');
  const { compressors } = await import('hyparquet-compressors');
  let records: Record<string, unknown>[];
  try {
    const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    records = (await parquetReadObjects({ file, compressors })) as Record<string, unknown>[];
  } catch {
    throw new RosterFileError('unreadable_file', 'This Parquet file could not be read.');
  }
  if (!records.length) return [];
  const header = Object.keys(records[0]!);
  return [header, ...records.map((r) => header.map((h) => cellText(r[h])))];
}
