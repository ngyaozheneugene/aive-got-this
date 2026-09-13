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

export const technicianUnavailablePayloadSchema = z.object({
  technicianId: z.string().min(1),
});

export const jobOverrunPayloadSchema = z.object({
  jobId: z.string().min(1),
  overrunMinutes: z.number().int().positive(),
});

export const createEventBodySchema = z.discriminatedUnion('type', [
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
