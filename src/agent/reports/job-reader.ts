// Agent-assisted & deterministic job / work order reader:
// Reads an uploaded CSV/spreadsheet/parquet and transforms it into candidate jobs
// ready for coordinator confirmation before committing. ADR 006 / ADR 008 / ADR 009.

import { z } from 'zod';
import {
  createJobBodySchema,
  type JobCandidateRow,
  type ParseJobsResponse,
} from '../../shared/contracts/jobs';
import { CLUSTER_LABEL, clusterForPostal } from '../../location/postal';
import type { GatewayMessage } from '../runtime/gateway';
import { parseCsvRows, recordsToCsv, type ReportChat } from './roster-reader';

export interface KnownJobTypeInfo {
  id: string;
  name: string;
  defaultMinutes?: number;
}

const DEFAULT_KNOWN_JOB_TYPES: KnownJobTypeInfo[] = [
  { id: 'GENERAL_SERVICE', name: 'General Aircon Service', defaultMinutes: 60 },
  { id: 'CHEMICAL_WASH', name: 'Chemical Wash', defaultMinutes: 90 },
  { id: 'WATER_LEAK', name: 'Water Leakage Repair', defaultMinutes: 90 },
  { id: 'GAS_TOPUP', name: 'Refrigerant Top-up (R32)', defaultMinutes: 60 },
  { id: 'INSTALLATION', name: 'New Unit Installation', defaultMinutes: 180 },
  { id: 'CRITICAL_HVAC_ELECTRICAL', name: 'Critical HVAC + electrical', defaultMinutes: 90 },
];

const CLEAN_HEADER = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function isStandardJobsTemplate(firstRow: string[]): boolean {
  const cleaned = firstRow.map(CLEAN_HEADER);
  const hasCustomer = cleaned.includes('customername') || (cleaned.includes('customer') && cleaned.includes('address'));
  const hasPostal = cleaned.includes('postalcode') || cleaned.includes('postal');
  const hasJobType = cleaned.includes('jobtypeid') || (cleaned.includes('jobtype') && cleaned.includes('windowstart'));
  return hasCustomer && hasPostal && (hasJobType || cleaned.includes('windowstart'));
}

export function validateAndAnnotateJob(
  raw: {
    customerName: string;
    phone: string;
    postalCode: string;
    address: string;
    unitNo?: string;
    jobTypeId: string;
    priority?: string;
    windowStart?: string;
    windowEnd?: string;
    date?: string;
    note?: string;
  },
  knownTypes: KnownJobTypeInfo[] = DEFAULT_KNOWN_JOB_TYPES,
): JobCandidateRow {
  const issues: string[] = [];
  const notices: string[] = [];

  const customerName = (raw.customerName || '').trim();
  if (!customerName || customerName.length < 2) {
    issues.push('Customer name is required.');
  }

  // Clean and normalize Singapore phone: strip whitespace, hyphens, and leading +65 / 65
  const cleanPhone = (raw.phone || '')
    .trim()
    .replace(/[\s-()]/g, '')
    .replace(/^\+?65(?=\d{8}$)/, '');

  if (!/^[3689]\d{7}$/.test(cleanPhone)) {
    issues.push(`Phone number "${raw.phone || '(blank)'}" must be an 8-digit Singapore number (starts with 3, 6, 8, or 9).`);
  }

  // Clean postal code
  const postal = (raw.postalCode || '').replace(/\D/g, '').padStart(6, '0').slice(-6);
  const cluster = /^\d{6}$/.test(postal) ? clusterForPostal(postal) : null;
  if (!cluster) {
    issues.push(`Postal code "${raw.postalCode || '(blank)'}" cannot be placed into a Singapore sector.`);
  }

  const address = (raw.address || '').trim() || (cluster ? `Location in ${CLUSTER_LABEL[cluster]}` : '');
  if (!address) {
    issues.push('Service address is required.');
  }

  // Resolve Job Type
  let matchedType = knownTypes.find(
    (t) =>
      t.id.toLowerCase() === raw.jobTypeId?.toLowerCase() ||
      t.name.toLowerCase() === raw.jobTypeId?.toLowerCase(),
  );

  if (!matchedType) {
    // Fuzzy match on common terms
    const lowId = (raw.jobTypeId || '').toLowerCase();
    if (lowId.includes('leak')) matchedType = knownTypes.find((t) => t.id === 'WATER_LEAK');
    else if (lowId.includes('gas') || lowId.includes('refrigerant') || lowId.includes('r32'))
      matchedType = knownTypes.find((t) => t.id === 'GAS_TOPUP');
    else if (lowId.includes('chem') || lowId.includes('flush') || lowId.includes('overhaul'))
      matchedType = knownTypes.find((t) => t.id === 'CHEMICAL_WASH');
    else if (lowId.includes('inverter') || lowId.includes('elect') || lowId.includes('buzz') || lowId.includes('burn'))
      matchedType = knownTypes.find((t) => t.id === 'CRITICAL_HVAC_ELECTRICAL');
    else if (lowId.includes('install'))
      matchedType = knownTypes.find((t) => t.id === 'INSTALLATION');
    else if (lowId.includes('service') || lowId.includes('general') || lowId.includes('clean'))
      matchedType = knownTypes.find((t) => t.id === 'GENERAL_SERVICE');
  }

  if (!matchedType) {
    matchedType = knownTypes[0] || { id: 'GENERAL_SERVICE', name: 'General Aircon Service', defaultMinutes: 60 };
    notices.push(`Defaulted job type to ${matchedType.name} (${matchedType.id}).`);
  }

  // Priority
  let priority: 'urgent' | 'on_demand' | 'when_available' = 'on_demand';
  const rawPri = (raw.priority || '').toLowerCase();
  if (rawPri.includes('urgent') || rawPri.includes('asap') || rawPri.includes('high') || rawPri.includes('emergency')) {
    priority = 'urgent';
  } else if (rawPri.includes('free') || rawPri.includes('available') || rawPri.includes('low') || rawPri.includes('flex')) {
    priority = 'when_available';
  }

  // Time window validation
  let windowStart = raw.windowStart?.trim() || '09:00';
  let windowEnd = raw.windowEnd?.trim() || '12:00';

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(windowStart)) {
    windowStart = '09:00';
    notices.push('Defaulted window start to 09:00.');
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(windowEnd)) {
    windowEnd = '12:00';
    notices.push('Defaulted window end to 12:00.');
  }

  if (windowEnd <= windowStart) {
    issues.push(`Time window end (${windowEnd}) must be later than window start (${windowStart}).`);
  } else {
    const [startH, startM] = windowStart.split(':').map(Number);
    const [endH, endM] = windowEnd.split(':').map(Number);
    const durationMinutes = (endH! * 60 + endM!) - (startH! * 60 + startM!);
    const requiredMin = matchedType.defaultMinutes ?? 60;
    if (durationMinutes < requiredMin) {
      issues.push(`Time window (${durationMinutes} mins) is too short for ${matchedType.name} (requires ${requiredMin} mins).`);
    }
  }

  // Validate against domain contract schema
  const parsed = createJobBodySchema.safeParse({
    customerName,
    phone: cleanPhone,
    postalCode: postal,
    address,
    unitNo: raw.unitNo?.trim() || undefined,
    jobTypeId: matchedType.id,
    priority,
    windowStart,
    windowEnd,
    date: raw.date,
    note: raw.note,
  });

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (!issues.includes(issue.message)) {
        issues.push(issue.message);
      }
    }
  }

  return {
    customerName,
    phone: cleanPhone,
    postalCode: postal,
    address,
    unitNo: raw.unitNo?.trim() || undefined,
    jobTypeId: matchedType.id,
    jobTypeName: matchedType.name,
    priority,
    windowStart,
    windowEnd,
    date: raw.date,
    note: raw.note?.trim() || undefined,
    cluster: cluster ? CLUSTER_LABEL[cluster] : null,
    isValid: issues.length === 0,
    issues,
    notices,
  };
}

/** Fast-path parsing for standard template CSVs (executes in <2ms). */
export function parseStandardJobsCsv(
  rows: string[][],
  knownTypes: KnownJobTypeInfo[] = DEFAULT_KNOWN_JOB_TYPES,
): ParseJobsResponse {
  const header = rows[0]!;
  const cleanedHeader = header.map(CLEAN_HEADER);

  const colCust = cleanedHeader.findIndex((h) => ['customername', 'customer', 'clientname', 'client'].includes(h));
  const colPhone = cleanedHeader.findIndex((h) => ['phone', 'contactnumber', 'contact', 'tel', 'mobile'].includes(h));
  const colPostal = cleanedHeader.findIndex((h) => ['postalcode', 'postal', 'postcode'].includes(h));
  const colAddress = cleanedHeader.findIndex((h) => ['address', 'location', 'street'].includes(h));
  const colUnit = cleanedHeader.findIndex((h) => ['unitno', 'unit', 'unitnumber', 'flat'].includes(h));
  const colJobType = cleanedHeader.findIndex((h) => ['jobtypeid', 'jobtype', 'servicetype', 'type'].includes(h));
  const colPriority = cleanedHeader.findIndex((h) => ['priority', 'urgency'].includes(h));
  const colWinStart = cleanedHeader.findIndex((h) => ['windowstart', 'start', 'from'].includes(h));
  const colWinEnd = cleanedHeader.findIndex((h) => ['windowend', 'end', 'to'].includes(h));
  const colNote = cleanedHeader.findIndex((h) => ['note', 'notes', 'symptoms', 'issue', 'reportedissue'].includes(h));

  const candidates: JobCandidateRow[] = [];

  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r]!;
    if (row.length === 0 || row.every((c) => !c.trim())) continue;

    const customerName = colCust >= 0 ? row[colCust] ?? '' : '';
    const phone = colPhone >= 0 ? row[colPhone] ?? '' : '';
    const postalCode = colPostal >= 0 ? row[colPostal] ?? '' : '';
    const address = colAddress >= 0 ? row[colAddress] ?? '' : '';
    const unitNo = colUnit >= 0 ? row[colUnit] ?? '' : '';
    const jobTypeId = colJobType >= 0 ? row[colJobType] ?? '' : '';
    const priority = colPriority >= 0 ? row[colPriority] ?? 'on_demand' : 'on_demand';
    const windowStart = colWinStart >= 0 ? row[colWinStart] ?? '09:00' : '09:00';
    const windowEnd = colWinEnd >= 0 ? row[colWinEnd] ?? '12:00' : '12:00';
    const note = colNote >= 0 ? row[colNote] ?? '' : '';

    candidates.push(
      validateAndAnnotateJob(
        {
          customerName,
          phone,
          postalCode,
          address,
          unitNo,
          jobTypeId,
          priority,
          windowStart,
          windowEnd,
          note,
        },
        knownTypes,
      ),
    );
  }

  return {
    source: 'template_fast_path',
    candidates,
    totalRows: candidates.length,
    validCount: candidates.filter((c) => c.isValid).length,
  };
}

/** Heuristic fallback parser for unstructured CRM ticket exports. */
export function parseJobsHeuristically(
  text: string,
  knownTypes: KnownJobTypeInfo[] = DEFAULT_KNOWN_JOB_TYPES,
): JobCandidateRow[] {
  const rows = parseCsvRows(text);
  const candidates: JobCandidateRow[] = [];

  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r]!;
    if (row.length < 2 || row.every((c) => !c.trim())) continue;
    const line = row.join(' ');
    // Skip header row
    if (r === 0 && (line.toLowerCase().includes('client') || line.toLowerCase().includes('customer'))) continue;

    const customerName = row[0]?.trim() || '';
    if (!customerName || customerName.length < 2) continue;

    // Extract phone
    const phoneMatch = line.match(/(?:\+?65[\s-]?)?([3689]\d{3}[\s-]?\d{4})\b/);
    const phone = phoneMatch ? phoneMatch[1]!.replace(/\D/g, '') : '';

    // Extract postal code (either with prefix or isolated 6 digits, avoiding phone numbers)
    const postalMatch =
      line.match(/(?:S|Postal|Singapore)\s*[:#]?\s*\(?(\d{6})\)?/i) ||
      line.match(/\b(\d{6})\b/);
    const postalCode = postalMatch ? postalMatch[1]! : '';

    // Extract unit number e.g. #08-14 or #12-01
    const unitMatch = line.match(/#(\d{1,3}-\d{1,4})/);
    const unitNo = unitMatch ? `#${unitMatch[1]}` : undefined;

    // Extract address snippet (excluding postal & unit)
    let address = '';
    const locMatch = line.match(/(?:at|location:|in)\s+([^,]+)/i);
    if (locMatch) address = locMatch[1]!.trim();
    else if (row[2]) address = row[2].replace(/\b\d{6}\b/, '').replace(/#\d+-\d+/, '').replace(/singapore/gi, '').trim();

    // Determine Job Type from keywords
    let jobTypeId = 'GENERAL_SERVICE';
    if (/leak|dripping|water|overflow/i.test(line)) jobTypeId = 'WATER_LEAK';
    else if (/gas|refrigerant|r32|r-32|top-up|low pressure/i.test(line)) jobTypeId = 'GAS_TOPUP';
    else if (/chem|chemical|wash|flush|overhaul/i.test(line)) jobTypeId = 'CHEMICAL_WASH';
    else if (/inverter|buzz|burn|smoke|tripped|compressor|circuit/i.test(line)) jobTypeId = 'CRITICAL_HVAC_ELECTRICAL';
    else if (/install|new unit|replace aircon/i.test(line)) jobTypeId = 'INSTALLATION';

    // Determine priority
    let priority: 'urgent' | 'on_demand' | 'when_available' = 'on_demand';
    if (/urgent|emergency|asap|high/i.test(line)) priority = 'urgent';
    else if (/flexible|free|available/i.test(line)) priority = 'when_available';

    // Determine window
    let windowStart = '09:00';
    let windowEnd = '12:00';
    const timeRangeMatch = line.match(/(\d{1,2}:[0-5]\d)\s*(?:-|to)\s*(\d{1,2}:[0-5]\d)/);
    if (timeRangeMatch) {
      windowStart = timeRangeMatch[1]!.padStart(5, '0');
      windowEnd = timeRangeMatch[2]!.padStart(5, '0');
    } else if (/morning/i.test(line)) {
      windowStart = '09:00';
      windowEnd = '12:00';
    } else if (/afternoon|2pm/i.test(line)) {
      windowStart = '14:00';
      windowEnd = '17:00';
    }

    const note = row[3]?.trim() || line;

    candidates.push(
      validateAndAnnotateJob(
        {
          customerName,
          phone,
          postalCode,
          address,
          unitNo,
          jobTypeId,
          priority,
          windowStart,
          windowEnd,
          note,
        },
        knownTypes,
      ),
    );
  }

  return candidates;
}

const JOBS_TOOL = {
  type: 'function',
  function: {
    name: 'submit_jobs_batch',
    description: 'Submit extracted HVAC service jobs and customer tickets from the uploaded document.',
    parameters: {
      type: 'object',
      properties: {
        jobs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              customerName: { type: 'string', description: 'Customer or business client name' },
              phone: { type: 'string', description: '8-digit Singapore phone number' },
              postalCode: { type: 'string', description: '6-digit Singapore postal code' },
              address: { type: 'string', description: 'Street address' },
              unitNo: { type: 'string', description: 'Unit number e.g. #08-14' },
              jobTypeId: {
                type: 'string',
                enum: [
                  'GENERAL_SERVICE',
                  'CHEMICAL_WASH',
                  'WATER_LEAK',
                  'GAS_TOPUP',
                  'INSTALLATION',
                  'CRITICAL_HVAC_ELECTRICAL',
                ],
                description: 'Matched HVAC service job type ID',
              },
              priority: {
                type: 'string',
                enum: ['urgent', 'on_demand', 'when_available'],
                description: 'Service priority / SLA urgency',
              },
              windowStart: { type: 'string', description: 'Window start time HH:MM e.g. 09:00' },
              windowEnd: { type: 'string', description: 'Window end time HH:MM e.g. 12:00' },
              note: { type: 'string', description: 'Customer reported issue or symptoms' },
            },
            required: ['customerName', 'phone', 'postalCode', 'jobTypeId', 'windowStart', 'windowEnd'],
          },
        },
      },
      required: ['jobs'],
    },
  },
};

const SYSTEM_PROMPT = `You are an expert field dispatch coordinator for a Singapore HVAC enterprise.
Your task is to parse an uploaded batch of service tickets/jobs and extract structured work orders.

Rules:
1. Extract customer/client name for each job.
2. Normalize Singapore phone numbers to 8 digits (starting with 3, 6, 8, or 9).
3. Extract the 6-digit Singapore postal code and address.
4. Classify customer complaints into one of the 6 job types:
   - "WATER_LEAK": dripping, water leakage, overflowing drain pan (min 90 mins)
   - "GAS_TOPUP": low refrigerant, R32 gas leak, blowing warm air (min 60 mins)
   - "CHEMICAL_WASH": chemical cleaning, chemical overhaul, dirty fan coil (min 90 mins)
   - "CRITICAL_HVAC_ELECTRICAL": inverter board error, electrical burn, circuit tripping, loud buzzing (min 90 mins)
   - "INSTALLATION": new split unit install, full system replacement (min 180 mins)
   - "GENERAL_SERVICE": routine 3-month servicing, filter check (min 60 mins)
5. Map time windows into HH:MM (e.g. Morning -> 09:00 to 12:00, Afternoon -> 14:00 to 17:00). Ensure windowEnd > windowStart.
6. Set priority: "urgent" if customer mentions emergency, urgent, leaking, server room; else "on_demand" or "when_available".
Always call the tool 'submit_jobs_batch' with your extracted list.`;

/** Master jobs reader function. */
export async function readJobs(
  text: string,
  chat?: ReportChat,
  signal?: AbortSignal,
  knownTypes: KnownJobTypeInfo[] = DEFAULT_KNOWN_JOB_TYPES,
): Promise<ParseJobsResponse> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { source: 'template_fast_path', candidates: [], totalRows: 0, validCount: 0 };
  }

  const rows = parseCsvRows(trimmed);
  if (rows.length > 0 && isStandardJobsTemplate(rows[0]!)) {
    return parseStandardJobsCsv(rows, knownTypes);
  }

  // If chat agent is available, invoke Gateway
  if (chat) {
    try {
      const messages: GatewayMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `UNTRUSTED_JOBS_DOCUMENT:\n\`\`\`csv\n${trimmed.slice(0, 8000)}\n\`\`\`` },
      ];

      const reply = await chat(messages, signal, [JOBS_TOOL]);
      const toolCall = reply.tool_calls?.[0];

      if (toolCall?.function.name === 'submit_jobs_batch') {
        const rawArgs =
          typeof toolCall.function.arguments === 'string'
            ? JSON.parse(toolCall.function.arguments)
            : toolCall.function.arguments;

        const jobs = (rawArgs as { jobs: Array<{
          customerName: string;
          phone: string;
          postalCode: string;
          address?: string;
          unitNo?: string;
          jobTypeId: string;
          priority?: string;
          windowStart?: string;
          windowEnd?: string;
          note?: string;
        }> }).jobs;

        if (Array.isArray(jobs) && jobs.length > 0) {
          const candidates = jobs.map((j) =>
            validateAndAnnotateJob(
              {
                customerName: j.customerName,
                phone: j.phone,
                postalCode: j.postalCode,
                address: j.address || '',
                unitNo: j.unitNo,
                jobTypeId: j.jobTypeId,
                priority: j.priority,
                windowStart: j.windowStart,
                windowEnd: j.windowEnd,
                note: j.note,
              },
              knownTypes,
            ),
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
      // Fall through to heuristic extractor
    }
  }

  // Fallback heuristic parser
  const candidates = parseJobsHeuristically(trimmed, knownTypes);
  return {
    source: 'agent_nlp_path',
    candidates,
    totalRows: candidates.length,
    validCount: candidates.filter((c) => c.isValid).length,
  };
}

/** Parse an Apache Parquet binary buffer into candidate jobs. */
export async function readJobsFromParquet(
  buffer: ArrayBuffer | Uint8Array,
  chat?: ReportChat,
  signal?: AbortSignal,
  knownTypes: KnownJobTypeInfo[] = DEFAULT_KNOWN_JOB_TYPES,
): Promise<ParseJobsResponse> {
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
  return readJobs(csvText, chat, signal, knownTypes);
}
