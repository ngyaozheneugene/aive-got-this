// Dispatch Coordinator v1.1 — database interface.
// Postgres is the product store. Memory is for tests.

import {
  AppUser,
  Technician,
  TechnicianCert,
  Shift,
  ShiftStatus,
  Customer,
  Site,
  SiteMemory,
  JobType,
  JobTypeCert,
  Job,
  JobStatus,
  JobRequirement,
  Assignment,
  StatusEvent,
  TravelMatrix,
  BoardSnapshot,
  DecisionLog,
  Approval,
  PlanMetrics,
  OperationalEvent,
  OperationalEventStatus,
  Proposal,
  ProposalStatus,
  CandidatePlan,
} from '../shared/types/domain';

/**
 * A snapshot was written against a board that is no longer the latest. Both
 * adapters throw it from `createSnapshot` when `sourceSnapshotId` is given and
 * is not the latest version, including when another commit wins a race to the
 * same version number. The commit path turns it into `stale_snapshot`.
 */
export class StaleSnapshotError extends Error {
  constructor(public readonly sourceSnapshotId: string) {
    super(`Board moved on from snapshot ${sourceSnapshotId}.`);
    this.name = 'StaleSnapshotError';
  }
}

/** By name, not instanceof: Next.js bundles each route with its own copy of this module. */
export function isStaleSnapshotError(e: unknown): e is StaleSnapshotError {
  return (e as { name?: unknown } | null)?.name === 'StaleSnapshotError';
}

export interface IDatabase {
  // Reset / Seeding
  seed(data?: Record<string, unknown>): Promise<void>;
  reset(): Promise<void>;

  /**
   * Run `fn` against a database whose writes land together or not at all.
   * Postgres runs it in one transaction. The in-memory adapter is
   * single-threaded and just calls `fn`; it does not roll back.
   */
  transaction<T>(fn: (db: IDatabase) => Promise<T>): Promise<T>;

  // Users
  users: {
    getById(id: string): Promise<AppUser | null>;
    getByCognitoSub(sub: string): Promise<AppUser | null>;
    getByDemoLogin(login: string): Promise<AppUser | null>;
    create(user: Omit<AppUser, 'id' | 'createdAt'>): Promise<AppUser>;
  };

  // Technicians & Certs
  technicians: {
    getById(id: string): Promise<Technician | null>;
    listAll(): Promise<Technician[]>;
    listActive(): Promise<Technician[]>;
    getCerts(technicianId: string): Promise<TechnicianCert[]>;
    certValidOn(technicianId: string, certType: string, dateStr: string): Promise<boolean>;
    addCert(cert: Omit<TechnicianCert, 'id' | 'createdAt'>): Promise<TechnicianCert>;
    create(tech: Omit<Technician, 'id' | 'createdAt'>): Promise<Technician>;
  };

  // Shifts
  shifts: {
    getByTechAndDate(technicianId: string, dateStr: string): Promise<Shift | null>;
    clockIn(technicianId: string, dateStr: string): Promise<Shift>;
    clockOut(technicianId: string, dateStr: string): Promise<Shift>;
    updateStatus(technicianId: string, dateStr: string, status: ShiftStatus): Promise<Shift>;
    /** Change any of status, clock-in and clock-out; fields left out keep their value. */
    patch(
      technicianId: string,
      dateStr: string,
      patch: { status?: ShiftStatus; clockInAt?: string; clockOutAt?: string },
    ): Promise<Shift>;
    listByDate(dateStr: string): Promise<Shift[]>;
  };

  // Customers & Sites
  customers: {
    getById(id: string): Promise<Customer | null>;
    getByPhone(phone: string): Promise<Customer | null>;
    create(customer: Omit<Customer, 'id' | 'createdAt'>): Promise<Customer>;
  };

  sites: {
    getById(id: string): Promise<Site | null>;
    getByCustomerId(customerId: string): Promise<Site[]>;
    getByPostalCode(postalCode: string): Promise<Site | null>;
    create(site: Omit<Site, 'id' | 'createdAt'>): Promise<Site>;
  };

  siteMemories: {
    getBySiteId(siteId: string): Promise<SiteMemory[]>;
    addNote(note: Omit<SiteMemory, 'id' | 'createdAt'>): Promise<SiteMemory>;
  };

  // Catalog
  jobTypes: {
    getById(id: string): Promise<JobType | null>;
    listAll(): Promise<JobType[]>;
    getCerts(jobTypeId: string): Promise<JobTypeCert[]>;
  };

  // Jobs
  jobs: {
    getById(id: string): Promise<Job | null>;
    create(job: Omit<Job, 'id' | 'createdAt' | 'updatedAt'>): Promise<Job>;
    updateStatus(jobId: string, status: JobStatus, actorId: string, actorRole: string, reason?: string): Promise<Job>;
    listUnassigned(): Promise<Job[]>;
    listByScheduledDate(dateStr: string): Promise<Job[]>;
  };

  jobRequirements: {
    getByJobId(jobId: string): Promise<JobRequirement | null>;
    create(req: Omit<JobRequirement, 'id' | 'createdAt'>): Promise<JobRequirement>;
  };

  // Assignments
  assignments: {
    getById(id: string): Promise<Assignment | null>;
    getByJobId(jobId: string): Promise<Assignment[]>;
    getActiveForTechnician(technicianId: string, dateStr: string): Promise<Assignment[]>;
    listAll(): Promise<Assignment[]>;
    createCommitted(params: {
      jobId: string;
      technicianId: string;
      snapshotId: string;
      windowStart?: string;
      windowEnd?: string;
      travelBeforeMinutes?: number;
      metrics?: PlanMetrics;
    }): Promise<Assignment>;
    createOffer(params: {
      jobId: string;
      technicianId: string;
      snapshotId: string;
      expiresInMinutes?: number;
      metrics?: PlanMetrics;
      decisionLogId?: string;
    }): Promise<Assignment>;
    acceptOffer(assignmentId: string): Promise<Assignment>;
    declineOffer(assignmentId: string): Promise<Assignment>;
    expireOffer(assignmentId: string): Promise<Assignment>;
    /**
     * Take an assignment off the live board without deleting it. The commit path
     * calls this before writing replacements, so a moved job stops counting
     * against its old technician while the row survives for the audit trail.
     */
    supersede(assignmentId: string, status: 'reassigned' | 'cancelled'): Promise<Assignment>;
  };

  // Audit Events
  statusEvents: {
    getByJobId(jobId: string): Promise<StatusEvent[]>;
    listAll(): Promise<StatusEvent[]>;
  };

  // Travel Matrix
  travelMatrix: {
    getTravelMinutes(fromCluster: string, toCluster: string, isPeak?: boolean): Promise<number>;
    listAll(): Promise<TravelMatrix[]>;
    setMatrix(entries: Array<{ fromCluster: string; toCluster: string; minutes: number; peakMinutes: number }>): Promise<void>;
  };

  // Snapshots & Decision Logs
  boardSnapshots: {
    getLatestVersion(): Promise<number>;
    getLatest(): Promise<BoardSnapshot | null>;
    getSnapshot(version: number): Promise<BoardSnapshot | null>;
    /** Throws StaleSnapshotError when `extra.sourceSnapshotId` is not the latest. */
    createSnapshot(
      data: Record<string, unknown>,
      extra?: { sourceSnapshotId?: string; triggerEventId?: string },
    ): Promise<BoardSnapshot>;
  };

  decisionLogs: {
    getById(id: string): Promise<DecisionLog | null>;
    /** Ordered trail for one event. Backs the audit endpoint and the trace drawer. */
    listByEvent(eventId: string): Promise<DecisionLog[]>;
    create(log: Omit<DecisionLog, 'id' | 'createdAt'>): Promise<DecisionLog>;
  };

  // Desk Approvals
  approvals: {
    getById(id: string): Promise<Approval | null>;
    /** Most recent decision row for a proposal. The commit guard reads this. */
    getByProposal(proposalId: string): Promise<Approval | null>;
    listPending(): Promise<Approval[]>;
    create(approval: Omit<Approval, 'id' | 'createdAt'>): Promise<Approval>;
    action(id: string, status: 'approved' | 'rejected', actionedBy: string, reason?: string): Promise<Approval>;
  };

  events: {
    getById(id: string): Promise<OperationalEvent | null>;
    create(event: Omit<OperationalEvent, 'id' | 'receivedAt'>): Promise<OperationalEvent>;
    updateStatus(id: string, status: OperationalEventStatus): Promise<OperationalEvent>;
  };

  proposals: {
    getById(id: string): Promise<Proposal | null>;
    getByEventId(eventId: string): Promise<Proposal | null>;
    create(proposal: Omit<Proposal, 'id' | 'createdAt'>): Promise<Proposal>;
    updateStatus(id: string, status: ProposalStatus, recommendedPlanId?: string): Promise<Proposal>;
  };

  candidatePlans: {
    getById(id: string): Promise<CandidatePlan | null>;
    listByProposal(proposalId: string): Promise<CandidatePlan[]>;
    create(plan: Omit<CandidatePlan, 'id' | 'createdAt'>): Promise<CandidatePlan>;
  };
}
