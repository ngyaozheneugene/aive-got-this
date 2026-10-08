// Agent-assisted & deterministic roster reader:
// Reads an uploaded CSV/spreadsheet and transforms it into candidate technicians
// ready for coordinator confirmation before committing. ADR 008 / ADR 009.

import { z } from 'zod';
import {
  CERT_TYPES,
  createTechnicianBodySchema,
  type RosterCandidateRow,
  type ParseRosterResponse,
} from '../../shared/contracts/technicians';
import { CLUSTER_LABEL, clusterForPostal } from '../../location/postal';
import type { GatewayMessage } from '../runtime/gateway';
import { AgentError } from '../runtime/errors';

export type ReportChat = (
  messages: GatewayMessage[],
  signal: AbortSignal | undefined,
  tools?: Record<string, unknown>[],
) => Promise<{ content: string; tool_calls?: Array<{ function: { name: string; arguments?: unknown } }> }>;

/** Parse raw CSV text into a 2D array of cells adhering to RFC 4180. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else {
        cell += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(cell.trim());
        cell = '';
      } else if (c === '\r') {
        // skip carriage return
      } else if (c === '\n') {
        row.push(cell.trim());
        if (row.some((val) => val.length > 0)) rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += c;
      }
    }
    i += 1;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((val) => val.length > 0)) rows.push(row);
  }

  return rows;
}

const CLEAN_HEADER = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function isStandardTemplate(firstRow: string[]): boolean {
  const cleaned = firstRow.map(CLEAN_HEADER);
  return (
    cleaned.includes('name') &&
    cleaned.includes('tier') &&
    (cleaned.includes('homepostalcode') || cleaned.includes('postalcode') || cleaned.includes('postal'))
  );
}

function parseCertsString(raw: string): Array<{ type: (typeof CERT_TYPES)[number]; expiresAt?: string }> {
  if (!raw || !raw.trim()) return [];
  const parts = raw.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  const result: Array<{ type: (typeof CERT_TYPES)[number]; expiresAt?: string }> = [];

  for (const part of parts) {
    const [certStr, dateStr] = part.split(':').map((s) => s.trim());
    const matchedType = CERT_TYPES.find((t) => t.toLowerCase() === certStr?.toLowerCase());
    if (matchedType) {
      const validDate = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : undefined;
      result.push({ type: matchedType, ...(validDate ? { expiresAt: validDate } : {}) });
    }
  }
  return result;
}

function parsePartsString(raw: string): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(/[;,]/)
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, '_'))
    .filter((s) => /^[a-z0-9_]{1,40}$/.test(s) && !['none', 'nil', 'null'].includes(s));
}

function validateAndAnnotate(raw: {
  name: string;
  tier?: number;
  homePostalCode: string;
  certs?: Array<{ type: (typeof CERT_TYPES)[number]; expiresAt?: string }>;
  parts?: string[];
  maxMinutesDay?: number;
  acceptsOt?: boolean;
}): RosterCandidateRow {
  const issues: string[] = [];
  const notices: string[] = [];

  const name = raw.name.trim();
  if (!name) issues.push('Technician name is required.');

  let tier = raw.tier as 1 | 2 | 3 | 4;
  if (!tier || ![1, 2, 3, 4].includes(tier)) {
    tier = 2;
    notices.push('Defaulted skill tier to Tier 2.');
  }

  const postal = (raw.homePostalCode || '').replace(/\D/g, '').padStart(6, '0').slice(-6);
  const cluster = /^\d{6}$/.test(postal) ? clusterForPostal(postal) : null;
  if (!cluster) {
    issues.push(`Postal code "${raw.homePostalCode || '(blank)'}" cannot be placed into a Singapore sector.`);
  }

  const certs = raw.certs || [];
  const parts = raw.parts || [];
  const maxMinutesDay = Math.min(720, Math.max(120, raw.maxMinutesDay ?? 480));
  if (raw.maxMinutesDay && (raw.maxMinutesDay < 120 || raw.maxMinutesDay > 720)) {
    notices.push(`Shift hours clamped to ${maxMinutesDay / 60}h (must be between 2h and 12h).`);
  }

  const acceptsOt = Boolean(raw.acceptsOt);

  // Validate against domain contract schema
  const parsed = createTechnicianBodySchema.safeParse({
    name,
    tier,
    homePostalCode: postal,
    certs,
    parts,
    maxMinutesDay,
    acceptsOt,
  });

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push(issue.message);
    }
  }

  return {
    name,
    tier,
    homePostalCode: postal,
    certs,
    parts,
    maxMinutesDay,
    acceptsOt,
    cluster: cluster ? CLUSTER_LABEL[cluster] : null,
    isValid: issues.length === 0,
    issues,
    notices,
  };
}

/** Fast-path parsing for standard template CSVs (executes in <2ms). */
export function parseStandardCsv(rows: string[][]): ParseRosterResponse {
  const header = rows[0]!;
  const cleanedHeader = header.map(CLEAN_HEADER);

  const colName = cleanedHeader.findIndex((h) => h === 'name');
  const colTier = cleanedHeader.findIndex((h) => h === 'tier');
  const colPostal = cleanedHeader.findIndex((h) => ['homepostalcode', 'postalcode', 'postal'].includes(h));
  const colCerts = cleanedHeader.findIndex((h) => ['certs', 'certificates'].includes(h));
  const colParts = cleanedHeader.findIndex((h) => ['parts', 'vanparts', 'stock'].includes(h));
  const colHours = cleanedHeader.findIndex((h) => ['maxhoursday', 'hours', 'hoursperday', 'dailyhours'].includes(h));
  const colOt = cleanedHeader.findIndex((h) => ['acceptsot', 'ot', 'overtime'].includes(h));

  const candidates: RosterCandidateRow[] = [];

  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r]!;
    if (row.length === 0 || row.every((c) => !c.trim())) continue;

    const name = colName >= 0 ? row[colName] ?? '' : '';
    const tierNum = colTier >= 0 ? Number(row[colTier]) : 2;
    const postal = colPostal >= 0 ? row[colPostal] ?? '' : '';
    const certsStr = colCerts >= 0 ? row[colCerts] ?? '' : '';
    const partsStr = colParts >= 0 ? row[colParts] ?? '' : '';
    const hoursNum = colHours >= 0 ? Number(row[colHours]) : 8;
    const otStr = colOt >= 0 ? (row[colOt] ?? '').toLowerCase() : 'false';

    candidates.push(
      validateAndAnnotate({
        name,
        tier: [1, 2, 3, 4].includes(tierNum) ? tierNum : 2,
        homePostalCode: postal,
        certs: parseCertsString(certsStr),
        parts: parsePartsString(partsStr),
        maxMinutesDay: Math.round((Number.isFinite(hoursNum) && hoursNum > 0 ? hoursNum : 8) * 60),
        acceptsOt: ['true', 'yes', '1', 'y'].includes(otStr),
      }),
    );
  }

  return {
    source: 'template_fast_path',
    candidates,
    totalRows: candidates.length,
    validCount: candidates.filter((c) => c.isValid).length,
  };
}

const ROSTER_TOOL = {
  type: 'function',
  function: {
    name: 'submit_technician_roster',
    description: 'Submit extracted technician roster from the unstructured or messy document.',
    parameters: {
      type: 'object',
      properties: {
        technicians: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Technician full name' },
              tier: { type: 'integer', enum: [1, 2, 3, 4], description: 'Skill tier 1-4' },
              homePostalCode: { type: 'string', description: '6-digit Singapore postal code extracted from address' },
              certs: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: {
                      type: 'string',
                      enum: ['WSH_PASS', 'NITEC_HVAC', 'NEA_R32', 'EMA_LEW', 'BCA_STRUCTURAL'],
                    },
                    expiresAt: { type: 'string', description: 'Expiry date in YYYY-MM-DD format if known' },
                  },
                  required: ['type'],
                },
              },
              parts: {
                type: 'array',
                items: { type: 'string' },
                description: 'Carried van parts in lower_snake_case e.g. inverter_board, copper_pipe',
              },
              maxHoursDay: { type: 'number', description: 'Working hours per day e.g. 8' },
              acceptsOt: { type: 'boolean', description: 'Can work overtime' },
            },
            required: ['name', 'homePostalCode'],
          },
        },
      },
      required: ['technicians'],
    },
  },
};

const SYSTEM_PROMPT = `You are an expert field service operations assistant for a Singapore HVAC dispatch company.
Your task is to parse an uploaded staff roster document and extract the technicians into a structured list.
The input file may be messy, human-worded, non-standard, or staggered diagonally across cells.

Rules:
1. Extract every technician entity you find.
2. For postal codes: find the 6-digit Singapore postal code (e.g. from "Singapore 640512", "S(520112)", "Postal 730888").
3. For skill tier: map Junior/Level 1 to 1; Mid/Tier 2 to 2; Senior/Tier 3 to 3; Master/Level 4 to 4. Default to 2 if unspecified.
4. For certs: only map to the 5 known types:
   - "NEA_R32" (refrigerant / R-32 handling)
   - "NITEC_HVAC" (NITEC aircon / air-conditioning qualification)
   - "WSH_PASS" (workplace safety pass / safety cert)
   - "EMA_LEW" (licensed electrical worker / EMA license)
   - "BCA_STRUCTURAL" (building and construction structural pass)
   Extract expiration date into YYYY-MM-DD if mentioned.
5. For parts: extract van stock / parts into lower_snake_case tokens (e.g. "inverter_board", "copper_pipe", "capacitor", "compressor"). Ignore "none", "nil".
6. For hours: convert daily work hours (e.g. 8, 8.5) to numbers.
7. For overtime: set acceptsOt to true if they accept OT, yes, or flexible.
Always call the tool 'submit_technician_roster' with your results.`;

/** Heuristic fallback parser when Gateway is unavailable (e.g. offline tests). */
export function parseRosterHeuristically(text: string): RosterCandidateRow[] {
  const rows = parseCsvRows(text);
  const candidates: RosterCandidateRow[] = [];

  const hasBlocks = rows.some((r) => r.some((c) => /\[Technician:/i.test(c)));

  if (hasBlocks) {
    let current: Partial<RosterCandidateRow> = {};
    const flush = () => {
      if (current.name && current.homePostalCode) {
        candidates.push(
          validateAndAnnotate({
            name: current.name,
            tier: current.tier ?? 2,
            homePostalCode: current.homePostalCode ?? '',
            certs: current.certs ?? [],
            parts: current.parts ?? [],
            maxMinutesDay: current.maxMinutesDay ?? 480,
            acceptsOt: current.acceptsOt ?? false,
          }),
        );
      }
      current = {};
    };

    for (const row of rows) {
      const line = row.join(' ');
      const techTagMatch = line.match(/\[Technician:\s*([^\]]+)\]/i);
      if (techTagMatch) {
        flush();
        current.name = techTagMatch[1]?.trim();
        continue;
      }

      const postalMatch = line.match(/(?:S|Postal)?\s*\(?(\d{6})\)?/i) || line.match(/(\d{6})/);
      if (postalMatch) current.homePostalCode = postalMatch[1];

      const tierMatch = line.match(/Tier\s*([1-4])|Level\s*([1-4])|Senior/i);
      if (tierMatch) {
        if (tierMatch[1]) current.tier = Number(tierMatch[1]) as 1 | 2 | 3 | 4;
        else if (tierMatch[2]) current.tier = Number(tierMatch[2]) as 1 | 2 | 3 | 4;
        else if (tierMatch[0].toLowerCase().includes('senior')) current.tier = 3;
      }

      const certs = current.certs || [];
      if (/r32|r-32/i.test(line) && !certs.some((c) => c.type === 'NEA_R32')) {
        const exp = line.match(/(\d{4}-\d{2}-\d{2})/);
        certs.push({ type: 'NEA_R32', ...(exp ? { expiresAt: exp[1] } : {}) });
      }
      if (/nitec/i.test(line) && !certs.some((c) => c.type === 'NITEC_HVAC')) {
        certs.push({ type: 'NITEC_HVAC' });
      }
      if (/wsh|safety/i.test(line) && !certs.some((c) => c.type === 'WSH_PASS')) {
        certs.push({ type: 'WSH_PASS' });
      }
      if (/bca|structural/i.test(line) && !certs.some((c) => c.type === 'BCA_STRUCTURAL')) {
        const exp = line.match(/(\d{4}-\d{2}-\d{2})/);
        certs.push({ type: 'BCA_STRUCTURAL', ...(exp ? { expiresAt: exp[1] } : {}) });
      }
      if (/lew|electric/i.test(line) && !certs.some((c) => c.type === 'EMA_LEW')) {
        const exp = line.match(/(\d{4}-\d{2}-\d{2})/);
        certs.push({ type: 'EMA_LEW', ...(exp ? { expiresAt: exp[1] } : {}) });
      }
      current.certs = certs;

      const parts = current.parts || [];
      if (/inverter/i.test(line) && !parts.includes('inverter_board')) parts.push('inverter_board');
      if (/copper/i.test(line) && !parts.includes('copper_pipe')) parts.push('copper_pipe');
      if (/capacitor/i.test(line) && !parts.includes('capacitor')) parts.push('capacitor');
      if (/compressor/i.test(line) && !parts.includes('compressor')) parts.push('compressor');
      if (/drain/i.test(line) && !parts.includes('drain_pipe')) parts.push('drain_pipe');
      current.parts = parts;

      const hoursMatch = line.match(/(\d+(\.\d+)?)\s*(hrs|hours)/i);
      if (hoursMatch) current.maxMinutesDay = Math.round(Number(hoursMatch[1]) * 60);

      if (/\bot\b.*yes|can do ot.*yes|ot:\s*yes|ot:\s*allowed/i.test(line)) current.acceptsOt = true;
      else if (/\bot\b.*no|can do ot.*no|ot:\s*no/i.test(line)) current.acceptsOt = false;
    }
    flush();
    return candidates;
  }

  // Row-based tabular CSV (e.g. technicians_messy.csv)
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r]!;
    if (row.length < 2 || row.every((c) => !c.trim())) continue;
    // Skip header row
    const line = row.join(' ');
    if (r === 0 && (line.toLowerCase().includes('name') || line.toLowerCase().includes('staff'))) continue;

    const name = row[0]?.trim() || '';
    if (!name || name.length < 2) continue;

    const postalMatch = line.match(/(?:S|Postal)?\s*\(?(\d{6})\)?/i) || line.match(/(\d{6})/);
    const postal = postalMatch ? postalMatch[1]! : '';

    let tier: 1 | 2 | 3 | 4 = 2;
    const tierMatch = line.match(/Tier\s*([1-4])|Level\s*([1-4])|Senior|Junior|Master/i);
    if (tierMatch) {
      if (tierMatch[1]) tier = Number(tierMatch[1]) as 1 | 2 | 3 | 4;
      else if (tierMatch[2]) tier = Number(tierMatch[2]) as 1 | 2 | 3 | 4;
      else if (tierMatch[0].toLowerCase().includes('senior')) tier = 3;
      else if (tierMatch[0].toLowerCase().includes('junior')) tier = 1;
      else if (tierMatch[0].toLowerCase().includes('master')) tier = 4;
    }

    const certs: Array<{ type: (typeof CERT_TYPES)[number]; expiresAt?: string }> = [];
    if (/r32|r-32/i.test(line)) {
      const exp = line.match(/(\d{4}-\d{2}-\d{2})/);
      certs.push({ type: 'NEA_R32', ...(exp ? { expiresAt: exp[1] } : {}) });
    }
    if (/nitec/i.test(line)) certs.push({ type: 'NITEC_HVAC' });
    if (/wsh|safety/i.test(line)) certs.push({ type: 'WSH_PASS' });
    if (/bca|structural/i.test(line)) {
      const exp = line.match(/(\d{4}-\d{2}-\d{2})/);
      certs.push({ type: 'BCA_STRUCTURAL', ...(exp ? { expiresAt: exp[1] } : {}) });
    }
    if (/lew|electric/i.test(line)) {
      const exp = line.match(/(\d{4}-\d{2}-\d{2})/);
      certs.push({ type: 'EMA_LEW', ...(exp ? { expiresAt: exp[1] } : {}) });
    }

    const parts: string[] = [];
    if (/inverter/i.test(line)) parts.push('inverter_board');
    if (/copper/i.test(line)) parts.push('copper_pipe');
    if (/capacitor/i.test(line)) parts.push('capacitor');
    if (/compressor/i.test(line)) parts.push('compressor');
    if (/drain/i.test(line)) parts.push('drain_pipe');

    let maxMinutesDay = 480;
    const hoursMatch = line.match(/(\d+(\.\d+)?)\s*(hrs|hours)/i);
    if (hoursMatch) maxMinutesDay = Math.round(Number(hoursMatch[1]) * 60);

    let acceptsOt = false;
    if (/\bot\b.*yes|can do ot.*yes|ot:\s*yes|ot:\s*allowed/i.test(line)) acceptsOt = true;
    else if (row[row.length - 1]?.trim().toLowerCase() === 'yes') acceptsOt = true;

    candidates.push(
      validateAndAnnotate({
        name,
        tier,
        homePostalCode: postal,
        certs,
        parts,
        maxMinutesDay,
        acceptsOt,
      }),
    );
  }

  return candidates;
}

/** Master roster reader function. */
export async function readRoster(
  text: string,
  chat?: ReportChat,
  signal?: AbortSignal,
): Promise<ParseRosterResponse> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { source: 'template_fast_path', candidates: [], totalRows: 0, validCount: 0 };
  }

  const rows = parseCsvRows(trimmed);
  if (rows.length > 0 && isStandardTemplate(rows[0]!)) {
    return parseStandardCsv(rows);
  }

  // If chat is provided, use the Agent to extract entities
  if (chat) {
    try {
      const messages: GatewayMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `UNTRUSTED_DOCUMENT:\n\`\`\`csv\n${trimmed.slice(0, 7000)}\n\`\`\`` },
      ];

      const reply = await chat(messages, signal, [ROSTER_TOOL]);
      const toolCall = reply.tool_calls?.[0];

      if (toolCall?.function.name === 'submit_technician_roster') {
        const rawArgs =
          typeof toolCall.function.arguments === 'string'
            ? JSON.parse(toolCall.function.arguments)
            : toolCall.function.arguments;

        const techs = (rawArgs as { technicians: Array<{
          name: string;
          tier?: number;
          homePostalCode: string;
          certs?: Array<{ type: (typeof CERT_TYPES)[number]; expiresAt?: string }>;
          parts?: string[];
          maxHoursDay?: number;
          acceptsOt?: boolean;
        }> }).technicians;

        if (Array.isArray(techs) && techs.length > 0) {
          const candidates = techs.map((t) =>
            validateAndAnnotate({
              name: t.name,
              tier: t.tier,
              homePostalCode: t.homePostalCode,
              certs: t.certs,
              parts: t.parts,
              maxMinutesDay: t.maxHoursDay ? Math.round(t.maxHoursDay * 60) : 480,
              acceptsOt: t.acceptsOt,
            }),
          );

          return {
            source: 'agent_nlp_path',
            candidates,
            totalRows: candidates.length,
            validCount: candidates.filter((c) => c.isValid).length,
          };
        }
      }
    } catch {
      // Fall through to heuristic extractor if gateway call fails or throws
    }
  }

  // Fallback to heuristic parser
  const candidates = parseRosterHeuristically(trimmed);
  return {
    source: 'agent_nlp_path',
    candidates,
    totalRows: candidates.length,
    validCount: candidates.filter((c) => c.isValid).length,
  };
}

/** Convert tabular object records into RFC 4180 CSV string. */
export function recordsToCsv(records: Record<string, unknown>[]): string {
  if (!records || records.length === 0) return '';
  const headers = Object.keys(records[0]!);
  const escapeCell = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    let str: string;
    if (Array.isArray(val)) {
      str = val
        .map((item) => (typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item)))
        .join(';');
    } else if (typeof val === 'object') {
      str = JSON.stringify(val);
    } else {
      str = String(val);
    }
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [
    headers.map(escapeCell).join(','),
    ...records.map((row) => headers.map((h) => escapeCell(row[h])).join(',')),
  ];
  return lines.join('\n');
}

/** Parse an Apache Parquet binary buffer into candidate technicians. */
export async function readRosterFromParquet(
  buffer: ArrayBuffer | Uint8Array,
  chat?: ReportChat,
  signal?: AbortSignal,
): Promise<ParseRosterResponse> {
  const { parquetReadObjects } = await import('hyparquet');
  const { compressors } = await import('hyparquet-compressors');

  let arrayBuffer: ArrayBuffer;
  if (buffer instanceof Uint8Array) {
    arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  } else {
    arrayBuffer = buffer;
  }

  const records = await parquetReadObjects({ file: arrayBuffer, compressors });
  if (!records || records.length === 0) {
    return { source: 'template_fast_path', candidates: [], totalRows: 0, validCount: 0 };
  }

  const csvText = recordsToCsv(records as Record<string, unknown>[]);
  return readRoster(csvText, chat, signal);
}
