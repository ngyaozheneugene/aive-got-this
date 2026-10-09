// Typed desk client. The desk only calls member 1's handlers; it renders the
// read models it gets back and never re-derives metrics or eligibility.
import type {
  Approval,
  BoardSnapshot,
  CandidatePlan,
  Customer,
  DecisionLog,
  DeskBoard,
  Job,
  JobType,
  OperationalEvent,
  PlanProfile,
  Proposal,
  Site,
} from '../../shared/types/domain';
import type { CreateJobBody, ParseJobsResponse, JobCandidateRow } from '../../shared/contracts/jobs';
export type { ParseJobsResponse, JobCandidateRow };
import type { CompanySettings, CreateJobTypeBody, UpdateJobTypeBody, UpdateSettingsBody } from '../../shared/contracts/settings';
export type { CompanySettings };
import type { ReadReportResult, ReportDraft } from '../../agent/reports/reader';
export type { ReadReportResult, ReportDraft };
import type { CreateTechnicianBody, UpdateTechnicianBody, ParseRosterResponse, RosterCandidateRow } from '../../shared/contracts/technicians';
import type { TeamMember } from '../../dispatch/technicians';
export type { TeamMember, ParseRosterResponse, RosterCandidateRow };

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

/** Which workspace the desk is looking at: the company's own, or the sample day. */
export type DeskWorkspace = 'live' | 'simulation';
let workspace: DeskWorkspace = 'live';

/** Every request after this goes to `next`. The page owns the choice. */
export function setDeskWorkspace(next: DeskWorkspace): void {
  workspace = next;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('x-workspace', workspace);
  const res = await fetch(url, { cache: 'no-store', ...init, headers });
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
  | { type: 'technician_unavailable'; payload: { technicianId: string; from?: string; until?: string } }
  | { type: 'job_overrun'; payload: { jobId: string; overrunMinutes: number } }
  | { type: 'place_waiting'; payload: { jobIds: string[] } }
  | { type: 'job_cancelled'; payload: { jobId: string; reason: 'customer_cancelled' | 'duplicate' | 'other' } };

const ACTOR = 'desk_coordinator';

export interface BookedJob {
  job: Job;
  customer: Customer;
  site: Site;
  customerIsNew: boolean;
}

export interface AuditResult {
  eventId: string;
  status: string;
  entries: DecisionLog[];
}

export const deskApi = {
  /** The board's own day, or another day to look ahead (read only). */
  getBoard: (date?: string) =>
    request<DeskBoard>(`/api/schedule/current${date ? `?date=${encodeURIComponent(date)}` : ''}`),

  reset: () => request<unknown>('/api/demo/reset', { method: 'POST' }),

  /** Everyone on the team, active or not, with certificates. */
  team: () => request<TeamMember[]>('/api/technicians'),

  addTechnician: (body: CreateTechnicianBody) =>
    request<TeamMember>('/api/technicians', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),

  updateTechnician: (id: string, body: UpdateTechnicianBody) =>
    request<TeamMember>(`/api/technicians/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),

  parseRoster: (input: string | { fileBase64: string; filename?: string }, signal?: AbortSignal) =>
    request<ParseRosterResponse>('/api/technicians/import/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(typeof input === 'string' ? { text: input } : input),
      signal,
    }),

  importTechnicians: (technicians: CreateTechnicianBody[]) =>
    request<{ ok: boolean; created: number; technicians: TeamMember[] }>('/api/technicians/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ technicians }),
    }),

  parseJobs: (input: string | { fileBase64: string; filename?: string }, signal?: AbortSignal) =>
    request<ParseJobsResponse>('/api/jobs/import/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(typeof input === 'string' ? { text: input } : input),
      signal,
    }),

  importJobs: (jobs: CreateJobBody[]) =>
    request<{ ok: boolean; created: number; jobs: Job[] }>('/api/jobs/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobs }),
    }),

  /** What can be booked, with the certificates each needs. */
  jobTypes: () => request<Array<JobType & { certs: string[] }>>('/api/job-types'),

  addJobType: (body: CreateJobTypeBody) =>
    request<JobType & { certs: string[] }>('/api/job-types', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),

  updateJobType: (id: string, body: UpdateJobTypeBody) =>
    request<JobType & { certs: string[] }>(`/api/job-types/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),

  /** The company's settings for this workspace. */
  settings: () => request<CompanySettings>('/api/settings'),

  updateSettings: (body: UpdateSettingsBody) =>
    request<CompanySettings>('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),

  /** Book a new job. It lands unassigned; raise an urgent_job event to place it. */
  createJob: (body: CreateJobBody) =>
    request<BookedJob>('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),

  /** `rawText`: the coordinator's own words, when the event came from a typed report. */
  createEvent: (body: EventBody, sourceSnapshotId?: string, rawText?: string) =>
    request<OperationalEvent>('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, sourceSnapshotId, ...(rawText ? { rawText } : {}) }),
    }),

  /** Read a typed report into one draft to confirm. Writes nothing. */
  readReport: (text: string, signal?: AbortSignal) =>
    request<ReadReportResult>('/api/reports/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal,
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
