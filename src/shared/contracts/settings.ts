import { z } from 'zod';
import { CERT_TYPES } from './technicians';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/** The company's own settings. One row per workspace. ADR 011. */
export const companySettingsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** When a standard working day starts: the clock-in for anyone without a stored shift. */
  dayStart: hhmm,
  /** When it ends: free time is counted up to here when nobody set a finish time. */
  dayEnd: hhmm,
  /** Which option the desk recommends first, until the coordinator changes it. */
  defaultProfile: z.enum(['sla_first', 'minimal_disruption']),
});

export type CompanySettings = z.infer<typeof companySettingsSchema>;

export const DEFAULT_SETTINGS: CompanySettings = {
  name: 'Your company',
  dayStart: '08:00',
  dayEnd: '18:00',
  defaultProfile: 'sla_first',
};

export const updateSettingsBodySchema = companySettingsSchema
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');

export type UpdateSettingsBody = z.infer<typeof updateSettingsBodySchema>;

/** A day of at least four hours, start before end. */
export function workingDayProblem(s: Pick<CompanySettings, 'dayStart' | 'dayEnd'>): string | null {
  return toMin(s.dayEnd) - toMin(s.dayStart) >= 240 ? null : 'The working day must be at least 4 hours, start before end.';
}

const jobTypeFields = {
  name: z.string().trim().min(1).max(60),
  minTier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  defaultMinutes: z.number().int().min(15).max(480),
  /** Certificates anyone doing this job must hold. */
  certs: z
    .array(z.enum(CERT_TYPES))
    .max(CERT_TYPES.length)
    .refine((cs) => new Set(cs).size === cs.length, 'each certificate once'),
};

/** A new kind of job the desk can book. ADR 011. */
export const createJobTypeBodySchema = z.object({ ...jobTypeFields, certs: jobTypeFields.certs.default([]) });

/** Editing one applies to new bookings; jobs already booked keep what they needed. */
export const updateJobTypeBodySchema = z
  .object(jobTypeFields)
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');

export type CreateJobTypeBody = z.infer<typeof createJobTypeBodySchema>;
export type UpdateJobTypeBody = z.infer<typeof updateJobTypeBodySchema>;
