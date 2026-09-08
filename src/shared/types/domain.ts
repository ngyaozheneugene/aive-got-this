// Dispatch Coordinator v1.1
// Shared domain types. Imports nothing.

export type AppRole = 'technician' | 'desk' | 'admin';

export type TechnicianTier = 1 | 2 | 3 | 4;

export type CertType = 
  | 'WSH_PASS'
  | 'BCA_STRUCTURAL'
  | 'NITEC_HVAC'
  | 'NEA_R32'
  | 'EMA_LEW';

export type ShiftStatus = 
  | 'scheduled'
  | 'clocked_in'
  | 'mc'
  | 'no_show'
  | 'completed';

export type JobStatus = 
  | 'received'
  | 'unassigned'
  | 'offered'
  | 'assigned'
  | 'en_route'
  | 'on_site'
  | 'done'
  | 'cancelled'
  | 'blocked_access'
  | 'needs_skill'
  | 'rescheduled'
  | 'no_candidates';

export type JobPriority = 
  | 'urgent'
  | 'on_demand'
  | 'when_available'
  | 'callback'
  | 'quote';

export type WindowType = 'tight' | 'loose';

export type AssignmentStatus = 
  | 'offered'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'reassigned'
  | 'cancelled';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export type JobLockState = 'none' | 'promised' | 'in_progress';

export type OperationalEventType =
  | 'urgent_job'
  | 'technician_unavailable'
  | 'job_overrun';

export type OperationalEventStatus =
  | 'RECEIVED'
  | 'VALIDATED'
  | 'PLANNING'
  | 'PROPOSAL_READY'
  | 'AWAITING_APPROVAL'
  | 'COMMITTED'
  | 'INVALID'
  | 'INFEASIBLE'
  | 'REJECTED'
  | 'SUPERSEDED'
  | 'FAILED';

export type PlanProfile = 'sla_first' | 'minimal_disruption';

export type RiskLevel = 'low' | 'medium' | 'high';

export type AutonomyMode = 'auto' | 'approval' | 'block';

export type ProposalStatus =
  | 'GENERATING'
  | 'VALIDATED'
  | 'RECOMMENDED'
  | 'APPROVED'
  | 'COMMITTED'
  | 'EXPIRED'
  | 'SUPERSEDED'
  | 'REJECTED';

export type StageAExclusionReason = 
  | 'missing_cert'
  | 'cert_expired'
  | 'tier_too_low'
  | 'not_clocked_in'
  | 'on_leave_or_mc'
  | 'max_minutes_exceeded'
  | 'no_fit_in_window';

// ============================================================================
// DOMAIN ENTITY INTERFACES
// ============================================================================

export interface AppUser {
  id: string;
  demoLogin?: string;
  cognitoSub?: string;
  role: AppRole;
  name: string;
  email?: string;
  phone?: string;
  createdAt: string;
}

export interface Technician {
  id: string;
  userId?: string;
  name: string;
  tier: TechnicianTier;
  homeRegion: string;
  currentCluster?: string;
  maxMinutesDay: number;
  acceptsOt: boolean;
  parts?: string[];
  tools?: string[];
  isActive: boolean;
  createdAt: string;
}

export interface TechnicianCert {
  id: string;
  technicianId: string;
  certType: CertType | string;
  brand?: string;
  issuedAt: string;
  expiresAt?: string;
  isLegalGate: boolean;
  createdAt: string;
}

export interface Shift {
  id: string;
  technicianId: string;
  shiftDate: string;
  status: ShiftStatus;
  clockInAt?: string;
  clockOutAt?: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  companyName?: string;
  createdAt: string;
}

export interface Site {
  id: string;
  customerId: string;
  postalCode: string;
  region: string;
  estateCluster: string;
  addressLine1: string;
  unitNo: string; // Masked until status is en_route
  lastTechnicianId?: string;
  preferredTechnicianId?: string;
  accessFlags: string[];
  createdAt: string;
}

export interface SiteMemory {
  id: string;
  siteId: string;
  jobId?: string;
  technicianId?: string;
  noteRaw: string; // Untrusted raw close-out note
  createdAt: string;
}

export interface JobType {
  id: string;
  name: string;
  minTier: TechnicianTier;
  difficulty: number;
  defaultMinutes: number;
  slaHours?: number;
  brandSensitive: boolean;
  createdAt: string;
}

export interface JobTypeCert {
  id: string;
  jobTypeId: string;
  certType: string;
  brandRequired: boolean;
}

export interface Recurrence {
  id: string;
  siteId: string;
  rrule: string;
  cadence: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  materialisedTo: string;
  holidayPolicy: 'skip' | 'next_working_day' | 'prior_working_day';
  createdAt: string;
}

export interface Job {
  id: string;
  customerId: string;
  siteId: string;
  jobTypeId: string;
  status: JobStatus;
  priority: JobPriority;
  windowType: WindowType;
  lockState?: JobLockState;
  scheduledDate: string;
  windowStart?: string;
  windowEnd?: string;
  durationMinutes?: number;
  partsRequired?: string[];
  toolsRequired?: string[];
  noteRaw: string;
  intakeParsed?: Record<string, unknown>;
  requiredCrewSize: number;
  boardVersionAtRank: number;
  confidenceScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface JobRequirement {
  id: string;
  jobId: string;
  minTier: TechnicianTier;
  requiredCerts: string[];
  brandRequired?: string;
  requiredCrewSize: number;
  createdAt: string;
}

export interface ScoreBreakdown {
  qualificationFit: number; // 45% weight
  travelCost: number;       // 25% weight
  clusterFit: number;       // 10% weight
  workload: number;         // 10% weight
  slaRisk: number;          // 10% weight
  overQualificationPenalty: number;
  totalScore: number;
}

export interface Assignment {
  id: string;
  jobId: string;
  technicianId: string;
  status: AssignmentStatus;
  snapshotId: string;
  windowStart?: string;
  windowEnd?: string;
  travelBeforeMinutes?: number;
  offeredAt: string;
  expiresAt?: string;
  acceptedAt?: string;
  scoreBreakdown: ScoreBreakdown;
  decisionLogId?: string;
}

export interface StatusEvent {
  id: string;
  jobId: string;
  fromStatus?: JobStatus;
  toStatus: JobStatus;
  actorId: string;
  actorRole: string;
  reason?: string;
  createdAt: string;
}

export interface TravelMatrix {
  id: string;
  fromCluster: string;
  toCluster: string;
  minutes: number;
  peakMinutes: number;
  source: 'fixture' | 'seeded' | 'calculated';
  createdAt: string;
}

export interface BoardSnapshot {
  id: string;
  version: number;
  sourceSnapshotId?: string;
  triggerEventId?: string;
  snapshotData: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  createdBy?: string;
  committedAt?: string;
  createdAt: string;
}

export interface DecisionLog {
  id: string;
  eventId?: string;
  eventType: string;
  playbook: string;
  sequence?: number;
  stage?: string;
  toolCalls: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: Record<string, unknown>;
  }>;
  summary: string;
  reasonCodes?: string[];
  durationMs?: number;
  result?: string;
  approvalId?: string;
  createdAt: string;
}

export interface Approval {
  id: string;
  proposalId?: string;
  threadId: string;
  jobId?: string;
  sourceSnapshotId?: string;
  triggerReason: string;
  recommendation: Record<string, unknown>;
  whoWouldBeLate?: Array<{ technicianId: string; name: string; delayedByMinutes: number }>;
  policyReasons?: string[];
  approvedPlanId?: string;
  status: ApprovalStatus;
  actionedBy?: string;
  actionedReason?: string;
  createdAt: string;
  actionedAt?: string;
}

export interface OperationalEvent {
  id: string;
  type: OperationalEventType;
  rawText: string;
  normalizedPayload: Record<string, unknown>;
  sourceSnapshotId?: string;
  affectedIds: string[];
  validationIssues: string[];
  status: OperationalEventStatus;
  receivedAt: string;
}

export interface Proposal {
  id: string;
  eventId: string;
  sourceSnapshotId: string;
  recommendedPlanId?: string;
  risk: RiskLevel;
  autonomyMode: AutonomyMode;
  status: ProposalStatus;
  createdAt: string;
}

export interface CandidatePlan {
  id: string;
  proposalId: string;
  sourceSnapshotId: string;
  profile: PlanProfile;
  assignments: Record<string, unknown>[];
  changeSet: Record<string, unknown>[];
  metrics: Record<string, unknown>;
  validations: Record<string, unknown>;
  solverTrace: Record<string, unknown>;
  timedOut: boolean;
  durationMs?: number;
  status: 'VALIDATED' | 'REJECTED' | 'RECOMMENDED';
  createdAt: string;
}

// ============================================================================
// MATCHING ENGINE & DESK READ MODELS
// ============================================================================

export interface EligibleTechnician {
  technician: Technician;
  isEligible: boolean;
  exclusionReasons: StageAExclusionReason[];
}

export interface RankedTechnician {
  technician: Technician;
  rank: number;
  scoreBreakdown: ScoreBreakdown;
  travelMinutes: number;
  isTopChoice: boolean;
}

export interface DeskBoardItem {
  job: Job;
  customer: Customer;
  site: Site;
  assignedTechnician?: Technician;
  topRanked: RankedTechnician[];
  eligibleCount: number;
  excludedCount: number;
}

export interface DeskProposalView {
  event: OperationalEvent;
  proposal: Proposal;
  plans: CandidatePlan[];
  sourceSnapshot: BoardSnapshot;
}
