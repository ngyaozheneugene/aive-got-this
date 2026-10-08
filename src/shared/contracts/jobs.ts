import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');

/**
 * A coordinator booking a job that is not on the board yet: a phone call from
 * a new or returning customer. It lands unassigned; planning places it.
 * `note` is the customer's own words and is stored as untrusted `noteRaw`.
 * ADR 006.
 */
export const createJobBodySchema = z
  .object({
    customerName: z.string().trim().min(1).max(120),
    /** Singapore number, 8 digits, optional +65. Finds a returning customer. */
    phone: z
      .string()
      .trim()
      .transform((p) => p.replace(/[\s-]/g, '').replace(/^\+?65(?=\d{8}$)/, ''))
      .pipe(z.string().regex(/^[3689]\d{7}$/, 'expected an 8-digit Singapore number')),
    postalCode: z.string().trim().regex(/^\d{6}$/, 'expected a 6-digit postal code'),
    address: z.string().trim().min(1).max(200),
    unitNo: z.string().trim().max(20).optional(),
    jobTypeId: z.string().min(1),
    priority: z.enum(['urgent', 'on_demand', 'when_available']),
    /** On the board's day unless `date` says otherwise. */
    windowStart: hhmm,
    windowEnd: hhmm,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    note: z.string().max(1000).optional(),
  })
  .refine((b) => b.windowEnd > b.windowStart, { path: ['windowEnd'], message: 'window must end after it starts' });

export type CreateJobBody = z.infer<typeof createJobBodySchema>;

/** Booking jobs from a file, all or nothing. ADR 013. */
export const MAX_IMPORT_JOBS = 200;
export const bulkCreateJobsBodySchema = z.object({
  jobs: z.array(createJobBodySchema).min(1).max(MAX_IMPORT_JOBS),
});

export type BulkCreateJobsBody = z.infer<typeof bulkCreateJobsBodySchema>;

export type JobPriority = CreateJobBody['priority'];

/**
 * One row of a job import preview. `null` means the file did not say clearly
 * and the coordinator must choose; `issues` are recomputed from the fields,
 * so fixing a field clears its issue. `notices` explain how the row was read.
 */
export interface JobCandidateRow {
  /** Row in the file where this job starts (1-based). */
  sourceRow: number;
  readBy: 'template' | 'assistant' | 'keywords';
  customerName: string;
  /** As written; checked as a Singapore number. */
  phone: string;
  postalCode: string;
  address: string;
  unitNo: string;
  jobTypeId: string | null;
  priority: JobPriority | null;
  /** HH:MM */
  windowStart: string | null;
  windowEnd: string | null;
  /** YYYY-MM-DD, or null for the board's day. */
  date: string | null;
  note: string;
  cluster: string | null;
  isValid: boolean;
  issues: string[];
  notices: string[];
}

export interface ParseJobsResponse {
  candidates: JobCandidateRow[];
  skipped: Array<{ sourceRow: number; reason: string }>;
  /** What the preview checks against while it is edited. */
  context: {
    today: string;
    jobTypes: Array<{ id: string; name: string; defaultMinutes: number }>;
    /** Bookings already on today's and tomorrow's board, as duplicate keys. */
    booked: string[];
  };
  assistantUnavailable: boolean;
  totalRows: number;
  validCount: number;
}
