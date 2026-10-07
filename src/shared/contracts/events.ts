import { z } from 'zod';

export const operationalEventTypeSchema = z.enum([
  'urgent_job',
  'technician_unavailable',
  'job_overrun',
]);

export const operationalEventStatusSchema = z.enum([
  'RECEIVED',
  'VALIDATED',
  'PLANNING',
  'PROPOSAL_READY',
  'AWAITING_APPROVAL',
  'COMMITTED',
  'INVALID',
  'INFEASIBLE',
  'REJECTED',
  'SUPERSEDED',
  'FAILED',
]);

export const urgentJobPayloadSchema = z.object({
  jobId: z.string().min(1),
});

/** An instant with its offset, e.g. 2026-10-07T14:00:00+08:00. */
const instantSchema = z.string().datetime({ offset: true });

/**
 * With neither bound the technician is out for the rest of the day. `until`
 * alone: out now, back at that time ("stuck in Jurong till 2pm"). `from`
 * alone: leaving at that time. Both together is a gap mid-day, which the
 * shift model cannot express yet; unavailabilityIssue() refuses it. ADR 005.
 */
export const technicianUnavailablePayloadSchema = z.object({
  technicianId: z.string().min(1),
  from: instantSchema.optional(),
  until: instantSchema.optional(),
});

export type TechnicianUnavailablePayload = z.infer<typeof technicianUnavailablePayloadSchema>;

/** Why an unavailability payload cannot be planned, or null. */
export function unavailabilityIssue(payload: TechnicianUnavailablePayload): string | null {
  if (payload.from && payload.until) return 'unavailable_window_both_bounds';
  return null;
}

/** A job runs on by at most a working day. */
export const MAX_OVERRUN_MINUTES = 480;

export const jobOverrunPayloadSchema = z.object({
  jobId: z.string().min(1),
  overrunMinutes: z.number().int().positive().max(MAX_OVERRUN_MINUTES),
});

const eventBodySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('urgent_job'),
    rawText: z.string().optional().default(''),
    sourceSnapshotId: z.string().optional(),
    payload: urgentJobPayloadSchema,
  }),
  z.object({
    type: z.literal('technician_unavailable'),
    rawText: z.string().optional().default(''),
    sourceSnapshotId: z.string().optional(),
    payload: technicianUnavailablePayloadSchema,
  }),
  z.object({
    type: z.literal('job_overrun'),
    rawText: z.string().optional().default(''),
    sourceSnapshotId: z.string().optional(),
    payload: jobOverrunPayloadSchema,
  }),
]);

export const createEventBodySchema = eventBodySchema.superRefine((body, ctx) => {
  if (body.type !== 'technician_unavailable') return;
  const issue = unavailabilityIssue(body.payload);
  if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['payload'], message: issue });
});

export const operationalEventSchema = z.object({
  id: z.string(),
  type: operationalEventTypeSchema,
  rawText: z.string(),
  normalizedPayload: z.record(z.unknown()),
  sourceSnapshotId: z.string().optional(),
  affectedIds: z.array(z.string()),
  validationIssues: z.array(z.string()),
  status: operationalEventStatusSchema,
  receivedAt: z.string(),
});

export type CreateEventBody = z.infer<typeof createEventBodySchema>;
