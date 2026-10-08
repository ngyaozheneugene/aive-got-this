import { z } from 'zod';

/** The certificates the desk knows. NEA_R32, BCA_STRUCTURAL and EMA_LEW are legal gates. */
export const CERT_TYPES = ['WSH_PASS', 'NITEC_HVAC', 'NEA_R32', 'EMA_LEW', 'BCA_STRUCTURAL'] as const;
export const LEGAL_GATE_CERTS: readonly string[] = ['NEA_R32', 'BCA_STRUCTURAL', 'EMA_LEW'];

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

const fields = {
  name: z.string().trim().min(1).max(80),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  /** Where their day starts: a postal code, placed on the travel matrix. */
  homePostalCode: z.string().trim().regex(/^\d{6}$/, 'expected a 6-digit postal code'),
  certs: z
    .array(z.object({ type: z.enum(CERT_TYPES), expiresAt: date.optional() }))
    .max(CERT_TYPES.length)
    .refine((cs) => new Set(cs.map((c) => c.type)).size === cs.length, 'each certificate once'),
  /** Parts carried on the van, e.g. inverter_board. */
  parts: z.array(z.string().trim().regex(/^[a-z0-9_]{1,40}$/, 'lower_snake_case')).max(20),
  acceptsOt: z.boolean(),
  maxMinutesDay: z.number().int().min(120).max(720),
};

/** Adding a technician from team setup. They work every day from 08:00 unless told otherwise. ADR 008. */
export const createTechnicianBodySchema = z.object({
  ...fields,
  certs: fields.certs.default([]),
  parts: fields.parts.default([]),
  acceptsOt: fields.acceptsOt.default(false),
  maxMinutesDay: fields.maxMinutesDay.default(480),
});

/** Editing one: any subset of the fields, plus taking them off the team. */
export const updateTechnicianBodySchema = z
  .object({ ...fields, isActive: z.boolean() })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');

export type CreateTechnicianBody = z.infer<typeof createTechnicianBodySchema>;
export type UpdateTechnicianBody = z.infer<typeof updateTechnicianBodySchema>;

/** Adding technicians from a roster file, all or nothing. ADR 012. */
export const MAX_ROSTER_ROWS = 200;
export const bulkCreateTechniciansSchema = z.object({
  technicians: z.array(createTechnicianBodySchema).min(1).max(MAX_ROSTER_ROWS),
});

export type BulkCreateTechniciansBody = z.infer<typeof bulkCreateTechniciansSchema>;

/** How a roster row was read: by code from the standard template, by the assistant, or by keyword matching. */
export type RosterReadBy = 'template' | 'assistant' | 'keywords';

/**
 * One row of an import preview. `null` means the file did not say clearly and
 * the coordinator must choose; `issues` are recomputed from the fields, so
 * fixing a field clears its issue. `notices` explain how the row was read.
 */
export interface RosterCandidateRow {
  /** Row in the file where this technician starts (1-based), for "see row 12". */
  sourceRow: number;
  readBy: RosterReadBy;
  name: string;
  tier: 1 | 2 | 3 | 4 | null;
  homePostalCode: string;
  certs: Array<{ type: (typeof CERT_TYPES)[number]; expiresAt?: string }>;
  parts: string[];
  maxMinutesDay: number | null;
  acceptsOt: boolean;
  cluster: string | null;
  isValid: boolean;
  issues: string[];
  notices: string[];
}

export interface ParseRosterResponse {
  candidates: RosterCandidateRow[];
  /** Records that were not read as a technician, so nothing disappears unexplained. */
  skipped: Array<{ sourceRow: number; reason: string }>;
  /** Names already on the team, for duplicate checks while the preview is edited. */
  teamNames: string[];
  /** The assistant could not be used for some or all rows (not configured, or a request failed). */
  assistantUnavailable: boolean;
  totalRows: number;
  validCount: number;
}
