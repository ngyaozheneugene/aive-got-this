import { z } from 'zod';
import { operationalEventSchema } from './events';

export const planProfileSchema = z.enum(['sla_first', 'minimal_disruption']);
export const solverEngineSchema = z.enum(['insertion', 'ortools', 'stub']);

export const planMetricsSchema = z.object({
  slaLatenessMinutes: z.number(),
  travelMinutes: z.number(),
  overtimeMinutes: z.number(),
  jobsMoved: z.number(),
  customersAffected: z.number(),
  unassignedCount: z.number(),
});

export const planValidationSchema = z.object({
  ok: z.boolean(),
  violations: z.array(z.string()),
});

export const plannedSlotSchema = z.object({
  jobId: z.string(),
  technicianId: z.string(),
  windowStart: z.string().optional(),
  windowEnd: z.string().optional(),
  travelBeforeMinutes: z.number().int().nonnegative().optional(),
});

export const boardScheduleSchema = z.object({
  date: z.string(),
  snapshotId: z.string(),
  snapshotVersion: z.number().int().nonnegative(),
  technicians: z.array(z.record(z.unknown())),
  jobs: z.array(z.record(z.unknown())),
  assignments: z.array(z.record(z.unknown())),
  travel: z.array(z.record(z.unknown())),
});

export const proposeInputSchema = z.object({
  event: operationalEventSchema,
  schedule: boardScheduleSchema,
  profile: planProfileSchema,
});

export const candidatePlanSchema = z.object({
  id: z.string(),
  proposalId: z.string(),
  sourceSnapshotId: z.string(),
  profile: planProfileSchema,
  assignments: z.array(plannedSlotSchema),
  changeSet: z.array(z.record(z.unknown())),
  metrics: planMetricsSchema,
  validations: planValidationSchema,
  solverTrace: z.record(z.unknown()),
  timedOut: z.boolean(),
  durationMs: z.number().optional(),
  status: z.enum(['VALIDATED', 'REJECTED', 'RECOMMENDED']),
  createdAt: z.string(),
});

export const proposeOutputSchema = z.object({
  plans: z.array(candidatePlanSchema),
  engine: solverEngineSchema,
  timedOut: z.boolean(),
  message: z.string().optional(),
});

export type ProposeInputParsed = z.infer<typeof proposeInputSchema>;
export type ProposeOutputParsed = z.infer<typeof proposeOutputSchema>;
