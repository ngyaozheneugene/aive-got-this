// Typed desk client. The desk only calls member 1's handlers; it renders the
// read models it gets back and never re-derives metrics or eligibility.
import type {
  Approval,
  BoardSnapshot,
  CandidatePlan,
  DecisionLog,
  DeskBoard,
  OperationalEvent,
  PlanProfile,
  Proposal,
} from '../../shared/types/domain';

/** Backend refusals arrive as { error, detail? }. Surface both, never swallow. */
export class DeskApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'DeskApiError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const body = (await res.json().catch(() => null)) as
    | (Partial<T> & { error?: string; detail?: string })
    | null;
  if (!res.ok) {
    const code = (body?.error as string) ?? `http_${res.status}`;
    throw new DeskApiError(code, res.status, body?.detail);
  }
  return body as T;
}

export interface PlanResult {
  proposal: Proposal;
  plans: CandidatePlan[];
  engine: string;
  timedOut: boolean;
  comparisonReady: boolean;
  comparisonReasons?: string[];
  selectionBasis: 'requested_profile' | 'available_validated_plan';
  agent: { runId: string; protocol: string; modelCalls: number; status: string };
}

export interface DecisionResult {
  approval: Approval;
  proposal: Proposal;
}

export interface CommitResult {
  ok: true;
  snapshot: { id: string; version: number };
  proposal: Proposal;
  applied: unknown[];
}

/** The disruption event bodies the platform accepts (see createEventBodySchema). */
export type EventBody =
  | { type: 'urgent_job'; payload: { jobId: string } }
  | { type: 'technician_unavailable'; payload: { technicianId: string } }
  | { type: 'job_overrun'; payload: { jobId: string; overrunMinutes: number } };

const ACTOR = 'desk_coordinator';

export interface AuditResult {
  eventId: string;
  status: string;
  entries: DecisionLog[];
}

export const deskApi = {
  getBoard: () => request<DeskBoard>('/api/schedule/current'),

  reset: () => request<unknown>('/api/demo/reset', { method: 'POST' }),

  createEvent: (body: EventBody, sourceSnapshotId?: string) =>
    request<OperationalEvent>('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, sourceSnapshotId }),
    }),

  getEvent: (eventId: string) => request<OperationalEvent>(`/api/events/${eventId}`),

  audit: (eventId: string) => request<AuditResult>(`/api/events/${eventId}/audit`),

  plan: (eventId: string, profile: PlanProfile = 'sla_first') =>
    request<PlanResult>(`/api/events/${eventId}/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile }),
    }),

  decide: (
    proposalId: string,
    decision: 'approved' | 'rejected',
    planId: string,
    reason: string,
  ) =>
    request<DecisionResult>(`/api/proposals/${proposalId}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision, planId, reason, actorId: ACTOR }),
    }),

  commit: (proposalId: string, planId: string, sourceSnapshotId: string) =>
    request<CommitResult>(`/api/proposals/${proposalId}/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planId, sourceSnapshotId, actorId: ACTOR }),
    }),
};

export type { BoardSnapshot, CandidatePlan, DeskBoard, OperationalEvent, Proposal };
