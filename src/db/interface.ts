// Dispatch Coordinator Agent v0.4
// Unified Database Interface Contract
// Both Postgres (src/db/postgres) and InMemory (src/db/memory) implement this interface.

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
  ApprovalStatus,
  ScoreBreakdown,
} from '../shared/types/domain';

export interface IDatabase {
  // Reset / Seeding
  seed(data?: Record<string, unknown>): Promise<void>;
  reset(): Promise<void>;

  // Users
  users: {
    getById(id: string): Promise<AppUser | null>;
    getByCognitoSub(sub: string): Promise<AppUser | null>;
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
    createOffer(params: {
      jobId: string;
      technicianId: string;
      snapshotId: string;
      expiresInMinutes?: number;
      scoreBreakdown: ScoreBreakdown;
      decisionLogId?: string;
    }): Promise<Assignment>;
    acceptOffer(assignmentId: string): Promise<Assignment>;
    declineOffer(assignmentId: string): Promise<Assignment>;
    expireOffer(assignmentId: string): Promise<Assignment>;
  };

  // Audit Events
  statusEvents: {
    getByJobId(jobId: string): Promise<StatusEvent[]>;
    listAll(): Promise<StatusEvent[]>;
  };

  // Travel Matrix
  travelMatrix: {
    getTravelMinutes(fromCluster: string, toCluster: string, isPeak?: boolean): Promise<number>;
    setMatrix(entries: Array<{ fromCluster: string; toCluster: string; minutes: number; peakMinutes: number }>): Promise<void>;
  };

  // Snapshots & Decision Logs
  boardSnapshots: {
    getLatestVersion(): Promise<number>;
    getSnapshot(version: number): Promise<BoardSnapshot | null>;
    createSnapshot(data: Record<string, unknown>): Promise<BoardSnapshot>;
  };

  decisionLogs: {
    getById(id: string): Promise<DecisionLog | null>;
    create(log: Omit<DecisionLog, 'id' | 'createdAt'>): Promise<DecisionLog>;
  };

  // Desk Approvals
  approvals: {
    getById(id: string): Promise<Approval | null>;
    listPending(): Promise<Approval[]>;
    create(approval: Omit<Approval, 'id' | 'createdAt'>): Promise<Approval>;
    action(id: string, status: 'approved' | 'rejected', actionedBy: string, reason?: string): Promise<Approval>;
  };
}
