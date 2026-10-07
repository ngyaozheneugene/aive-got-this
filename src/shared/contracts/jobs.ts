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
