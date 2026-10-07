// Partial coverage: a plan may leave a booked job without a technician when
// nobody can legally take it, so the coordinator can call the customer instead
// of the whole disruption going unplanned. Recorded in the plan's changeSet as
// { action: 'unassign', jobId, fromTechnicianId, reason }. ADR 007.

import type { CandidatePlan } from '../shared/types/domain';

/** Nobody qualified; qualified people but no time; or the window was promised to this technician. */
export type UnassignReason = 'no_legal_technician' | 'no_time' | 'promised';

export interface UnassignedJob {
  jobId: string;
  fromTechnicianId?: string;
  reason: UnassignReason;
}

export function unassignChange(job: UnassignedJob): Record<string, unknown> {
  return { action: 'unassign', jobId: job.jobId, fromTechnicianId: job.fromTechnicianId ?? null, reason: job.reason };
}

/** The jobs a plan leaves for a call, in changeSet order. */
export function unassignedOf(plan: Pick<CandidatePlan, 'changeSet'>): UnassignedJob[] {
  return (plan.changeSet ?? [])
    .filter((c) => c.action === 'unassign' && typeof c.jobId === 'string')
    .map((c) => ({
      jobId: c.jobId as string,
      fromTechnicianId: typeof c.fromTechnicianId === 'string' ? c.fromTechnicianId : undefined,
      reason: c.reason === 'no_legal_technician' || c.reason === 'promised' ? c.reason : 'no_time',
    }));
}
