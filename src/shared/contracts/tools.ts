import { z } from 'zod';
import { planProfileSchema } from './propose';

export const toolNameSchema = z.enum([
  'retrieve_board',
  'propose',
  'validate',
  'classify_risk',
  'request_approval',
  'commit',
  'audit',
]);

export const retrieveBoardArgsSchema = z.object({
  snapshotId: z.string().optional(),
});

export const proposeToolArgsSchema = z.object({
  eventId: z.string(),
  profile: planProfileSchema,
});

export const validateToolArgsSchema = z.object({
  planId: z.string(),
});

export const classifyRiskArgsSchema = z.object({
  proposalId: z.string(),
});

export const requestApprovalArgsSchema = z.object({
  proposalId: z.string(),
  planId: z.string(),
  reason: z.string().min(1),
});

export const commitToolArgsSchema = z.object({
  proposalId: z.string(),
  planId: z.string(),
  sourceSnapshotId: z.string(),
});

export const auditToolArgsSchema = z.object({
  eventId: z.string(),
});

export const proposalDecisionBodySchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  planId: z.string().optional(),
  reason: z.string().min(1),
  actorId: z.string().min(1),
});

export const proposalCommitBodySchema = z.object({
  planId: z.string(),
  sourceSnapshotId: z.string(),
  actorId: z.string().min(1),
});
