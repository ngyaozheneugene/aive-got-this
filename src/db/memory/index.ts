import { EASTWIND, type Scenario } from '../../shared/fixtures/eastwind';
import { emptyPlanMetrics } from '../../shared/types/domain';
import type {
  AppUser,
  Approval,
  Assignment,
  BoardSnapshot,
  CandidatePlan,
  Customer,
  DecisionLog,
  Job,
  JobRequirement,
  JobStatus,
  JobType,
  JobTypeCert,
  OperationalEvent,
  OperationalEventStatus,
  PlanMetrics,
  Proposal,
  ProposalStatus,
  Shift,
  ShiftStatus,
  Site,
  SiteMemory,
  StatusEvent,
  Technician,
  TechnicianCert,
  TravelMatrix,
} from '../../shared/types/domain';
import { StaleSnapshotError, type IDatabase } from '../interface';

// List order matches the Postgres adapter's ORDER BY exactly, so planning sees
// the same input whichever adapter is behind it: by id, and assignments by job
// then booking time. postgres.contract.test.ts compares the two.
// Code-point order, as Postgres sorts with COLLATE "C" (localeCompare is not).
function codePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byId<T extends { id: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => codePoint(a.id, b.id));
}

function byBooking(a: Assignment, b: Assignment): number {
  return Date.parse(a.offeredAt) - Date.parse(b.offeredAt) || codePoint(a.id, b.id);
}

function byJobThenBooking(a: Assignment, b: Assignment): number {
  return codePoint(a.jobId, b.jobId) || byBooking(a, b);
}

export class InMemoryDatabase implements IDatabase {
  private usersMap = new Map<string, AppUser>();
  private techniciansMap = new Map<string, Technician>();
  private certsMap = new Map<string, TechnicianCert>();
  private shiftsMap = new Map<string, Shift>();
  private customersMap = new Map<string, Customer>();
  private sitesMap = new Map<string, Site>();
  private siteMemoriesMap = new Map<string, SiteMemory>();
  private jobTypesMap = new Map<string, JobType>();
  private jobTypeCertsMap = new Map<string, JobTypeCert>();
  private jobsMap = new Map<string, Job>();
  private jobRequirementsMap = new Map<string, JobRequirement>();
  private assignmentsMap = new Map<string, Assignment>();
  private statusEventRows: StatusEvent[] = [];
  private travelMatrixMap = new Map<string, TravelMatrix>();
  private boardSnapshotRows: BoardSnapshot[] = [];
  private decisionLogsMap = new Map<string, DecisionLog>();
  private approvalsMap = new Map<string, Approval>();
  private eventsMap = new Map<string, OperationalEvent>();
  private proposalsMap = new Map<string, Proposal>();
  private candidatePlansMap = new Map<string, CandidatePlan>();
  private idCounter = 1;

  /**
   * What a reset restores. A builder rather than data, so a scenario dated
   * "today" is re-dated by every reset. Defaults to the fixed Eastwind fixture
   * the tests are written against.
   */
  private readonly scenario: () => Scenario;

  constructor(options: { scenario?: () => Scenario } = {}) {
    this.scenario = options.scenario ?? (() => EASTWIND);
    this.hydrate();
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${(this.idCounter++).toString(36)}`;
  }

  private nowIso(): string {
    return new Date().toISOString();
  }

  private clearAll(): void {
    this.usersMap.clear();
    this.techniciansMap.clear();
    this.certsMap.clear();
    this.shiftsMap.clear();
    this.customersMap.clear();
    this.sitesMap.clear();
    this.siteMemoriesMap.clear();
    this.jobTypesMap.clear();
    this.jobTypeCertsMap.clear();
    this.jobsMap.clear();
    this.jobRequirementsMap.clear();
    this.assignmentsMap.clear();
    this.statusEventRows = [];
    this.travelMatrixMap.clear();
    this.boardSnapshotRows = [];
    this.decisionLogsMap.clear();
    this.approvalsMap.clear();
    this.eventsMap.clear();
    this.proposalsMap.clear();
    this.candidatePlansMap.clear();
  }

  private hydrate(): void {
    const data = this.scenario();
    this.clearAll();
    data.users.forEach((u) => this.usersMap.set(u.id, u));
    data.technicians.forEach((t) => this.techniciansMap.set(t.id, t));
    data.certs.forEach((c) => this.certsMap.set(c.id, c));
    data.shifts.forEach((s) => this.shiftsMap.set(`${s.technicianId}_${s.shiftDate}`, s));
    data.customers.forEach((c) => this.customersMap.set(c.id, c));
    data.sites.forEach((s) => this.sitesMap.set(s.id, s));
    data.jobTypes.forEach((j) => this.jobTypesMap.set(j.id, j));
    data.jobTypeCerts.forEach((j) => this.jobTypeCertsMap.set(j.id, j));
    data.jobs.forEach((j) => this.jobsMap.set(j.id, j));
    data.jobRequirements.forEach((j) => this.jobRequirementsMap.set(j.id, j));
    data.assignments.forEach((a) => this.assignmentsMap.set(a.id, a));
    data.travel.forEach((t) => this.travelMatrixMap.set(`${t.fromCluster}_${t.toCluster}`, t));
    this.boardSnapshotRows = [data.snapshot];
  }

  public async reset(): Promise<void> {
    this.hydrate();
  }

  public async seed(): Promise<void> {
    this.hydrate();
  }

  public async transaction<T>(fn: (db: IDatabase) => Promise<T>): Promise<T> {
    return fn(this);
  }

  users = {
    getById: async (id: string) => this.usersMap.get(id) ?? null,
    getByCognitoSub: async (sub: string) =>
      Array.from(this.usersMap.values()).find((u) => u.cognitoSub === sub) ?? null,
    getByDemoLogin: async (login: string) =>
      Array.from(this.usersMap.values()).find((u) => u.demoLogin === login) ?? null,
    create: async (user: Omit<AppUser, 'id' | 'createdAt'>) => {
      const created: AppUser = { ...user, id: this.generateId('usr'), createdAt: this.nowIso() };
      this.usersMap.set(created.id, created);
      return created;
    },
  };

  technicians = {
    getById: async (id: string) => this.techniciansMap.get(id) ?? null,
    listAll: async () => byId(Array.from(this.techniciansMap.values())),
    listActive: async () => byId(Array.from(this.techniciansMap.values()).filter((t) => t.isActive)),
    getCerts: async (technicianId: string) =>
      byId(Array.from(this.certsMap.values()).filter((c) => c.technicianId === technicianId)),
    certValidOn: async (technicianId: string, certType: string, dateStr: string) => {
      const target = new Date(dateStr);
      return Array.from(this.certsMap.values()).some((c) => {
        if (c.technicianId !== technicianId || c.certType !== certType) return false;
        if (new Date(c.issuedAt) > target) return false;
        if (!c.expiresAt) return true;
        return new Date(c.expiresAt) >= target;
      });
    },
    addCert: async (cert: Omit<TechnicianCert, 'id' | 'createdAt'>) => {
      const created: TechnicianCert = { ...cert, id: this.generateId('cert'), createdAt: this.nowIso() };
      this.certsMap.set(created.id, created);
      return created;
    },
    create: async (tech: Omit<Technician, 'id' | 'createdAt'>) => {
      const created: Technician = { ...tech, id: this.generateId('tech'), createdAt: this.nowIso() };
      this.techniciansMap.set(created.id, created);
      return created;
    },
  };

  shifts = {
    getByTechAndDate: async (technicianId: string, dateStr: string) =>
      this.shiftsMap.get(`${technicianId}_${dateStr}`) ?? null,
    clockIn: async (technicianId: string, dateStr: string) => {
      const key = `${technicianId}_${dateStr}`;
      const existing = this.shiftsMap.get(key);
      const updated: Shift = {
        id: existing?.id ?? this.generateId('shf'),
        technicianId,
        shiftDate: dateStr,
        status: 'clocked_in',
        clockInAt: this.nowIso(),
        clockOutAt: existing?.clockOutAt,
        createdAt: existing?.createdAt ?? this.nowIso(),
      };
      this.shiftsMap.set(key, updated);
      return updated;
    },
    clockOut: async (technicianId: string, dateStr: string) => {
      const key = `${technicianId}_${dateStr}`;
      const existing = this.shiftsMap.get(key);
      if (!existing) throw new Error(`Shift not found for technician ${technicianId} on ${dateStr}`);
      const updated: Shift = { ...existing, status: 'completed', clockOutAt: this.nowIso() };
      this.shiftsMap.set(key, updated);
      return updated;
    },
    updateStatus: async (technicianId: string, dateStr: string, status: ShiftStatus) => {
      const key = `${technicianId}_${dateStr}`;
      const existing = this.shiftsMap.get(key);
      const updated: Shift = {
        id: existing?.id ?? this.generateId('shf'),
        technicianId,
        shiftDate: dateStr,
        status,
        clockInAt: existing?.clockInAt,
        clockOutAt: existing?.clockOutAt,
        createdAt: existing?.createdAt ?? this.nowIso(),
      };
      this.shiftsMap.set(key, updated);
      return updated;
    },
    patch: async (
      technicianId: string,
      dateStr: string,
      patch: { status?: ShiftStatus; clockInAt?: string; clockOutAt?: string },
    ) => {
      const key = `${technicianId}_${dateStr}`;
      const existing = this.shiftsMap.get(key);
      const updated: Shift = {
        id: existing?.id ?? this.generateId('shf'),
        technicianId,
        shiftDate: dateStr,
        status: patch.status ?? existing?.status ?? 'scheduled',
        clockInAt: patch.clockInAt ?? existing?.clockInAt,
        clockOutAt: patch.clockOutAt ?? existing?.clockOutAt,
        createdAt: existing?.createdAt ?? this.nowIso(),
      };
      this.shiftsMap.set(key, updated);
      return updated;
    },
    listByDate: async (dateStr: string) =>
      Array.from(this.shiftsMap.values())
        .filter((s) => s.shiftDate === dateStr)
        .sort((a, b) => codePoint(a.technicianId, b.technicianId)),
  };

  customers = {
    getById: async (id: string) => this.customersMap.get(id) ?? null,
    getByPhone: async (phone: string) =>
      Array.from(this.customersMap.values()).find((c) => c.phone === phone) ?? null,
    create: async (customer: Omit<Customer, 'id' | 'createdAt'>) => {
      const created: Customer = { ...customer, id: this.generateId('cust'), createdAt: this.nowIso() };
      this.customersMap.set(created.id, created);
      return created;
    },
  };

  sites = {
    getById: async (id: string) => this.sitesMap.get(id) ?? null,
    getByCustomerId: async (customerId: string) =>
      byId(Array.from(this.sitesMap.values()).filter((s) => s.customerId === customerId)),
    getByPostalCode: async (postalCode: string) =>
      Array.from(this.sitesMap.values()).find((s) => s.postalCode === postalCode) ?? null,
    create: async (site: Omit<Site, 'id' | 'createdAt'>) => {
      const created: Site = { ...site, id: this.generateId('site'), createdAt: this.nowIso() };
      this.sitesMap.set(created.id, created);
      return created;
    },
  };

  siteMemories = {
    getBySiteId: async (siteId: string) =>
      Array.from(this.siteMemoriesMap.values()).filter((m) => m.siteId === siteId),
    addNote: async (note: Omit<SiteMemory, 'id' | 'createdAt'>) => {
      const created: SiteMemory = { ...note, id: this.generateId('mem'), createdAt: this.nowIso() };
      this.siteMemoriesMap.set(created.id, created);
      return created;
    },
  };

  jobTypes = {
    getById: async (id: string) => this.jobTypesMap.get(id) ?? null,
    listAll: async () => byId(Array.from(this.jobTypesMap.values())),
    getCerts: async (jobTypeId: string) =>
      byId(Array.from(this.jobTypeCertsMap.values()).filter((c) => c.jobTypeId === jobTypeId)),
  };

  jobs = {
    getById: async (id: string) => this.jobsMap.get(id) ?? null,
    create: async (job: Omit<Job, 'id' | 'createdAt' | 'updatedAt'>) => {
      const now = this.nowIso();
      const created: Job = { ...job, id: this.generateId('job'), createdAt: now, updatedAt: now };
      this.jobsMap.set(created.id, created);
      return created;
    },
    updateStatus: async (jobId: string, status: JobStatus, actorId: string, actorRole: string, reason?: string) => {
      const existing = this.jobsMap.get(jobId);
      if (!existing) throw new Error(`Job ${jobId} not found`);
      const fromStatus = existing.status;
      const updated = { ...existing, status, updatedAt: this.nowIso() };
      this.jobsMap.set(jobId, updated);
      this.statusEventRows.push({
        id: this.generateId('ste'),
        jobId,
        fromStatus,
        toStatus: status,
        actorId,
        actorRole,
        reason,
        createdAt: this.nowIso(),
      });
      return updated;
    },
    listUnassigned: async () =>
      byId(Array.from(this.jobsMap.values()).filter((j) => j.status === 'unassigned' || j.status === 'received')),
    listByScheduledDate: async (dateStr: string) =>
      byId(Array.from(this.jobsMap.values()).filter((j) => j.scheduledDate === dateStr)),
  };

  jobRequirements = {
    getByJobId: async (jobId: string) =>
      Array.from(this.jobRequirementsMap.values()).find((r) => r.jobId === jobId) ?? null,
    create: async (req: Omit<JobRequirement, 'id' | 'createdAt'>) => {
      const created: JobRequirement = { ...req, id: this.generateId('jreq'), createdAt: this.nowIso() };
      this.jobRequirementsMap.set(created.id, created);
      return created;
    },
  };

  assignments = {
    getById: async (id: string) => this.assignmentsMap.get(id) ?? null,
    getByJobId: async (jobId: string) =>
      Array.from(this.assignmentsMap.values()).filter((a) => a.jobId === jobId).sort(byBooking),
    listAll: async () => Array.from(this.assignmentsMap.values()).sort(byJobThenBooking),
    getActiveForTechnician: async (technicianId: string, dateStr: string) => {
      const jobIds = new Set(
        Array.from(this.jobsMap.values()).filter((j) => j.scheduledDate === dateStr).map((j) => j.id),
      );
      return Array.from(this.assignmentsMap.values()).filter(
        (a) =>
          a.technicianId === technicianId &&
          jobIds.has(a.jobId) &&
          (a.status === 'accepted' || a.status === 'offered'),
      );
    },
    createCommitted: async (params: {
      jobId: string;
      technicianId: string;
      snapshotId: string;
      windowStart?: string;
      windowEnd?: string;
      travelBeforeMinutes?: number;
      metrics?: PlanMetrics;
    }) => {
      const created: Assignment = {
        id: this.generateId('asg'),
        jobId: params.jobId,
        technicianId: params.technicianId,
        status: 'accepted',
        snapshotId: params.snapshotId,
        windowStart: params.windowStart,
        windowEnd: params.windowEnd,
        travelBeforeMinutes: params.travelBeforeMinutes,
        offeredAt: this.nowIso(),
        acceptedAt: this.nowIso(),
        metrics: params.metrics ?? emptyPlanMetrics(),
      };
      this.assignmentsMap.set(created.id, created);
      return created;
    },
    createOffer: async (params: {
      jobId: string;
      technicianId: string;
      snapshotId: string;
      expiresInMinutes?: number;
      metrics?: PlanMetrics;
      decisionLogId?: string;
    }) => {
      const now = new Date();
      const expires = new Date(now.getTime() + (params.expiresInMinutes ?? 10) * 60 * 1000);
      const created: Assignment = {
        id: this.generateId('asg'),
        jobId: params.jobId,
        technicianId: params.technicianId,
        status: 'offered',
        snapshotId: params.snapshotId,
        offeredAt: now.toISOString(),
        expiresAt: expires.toISOString(),
        metrics: params.metrics ?? emptyPlanMetrics(),
        decisionLogId: params.decisionLogId,
      };
      this.assignmentsMap.set(created.id, created);
      return created;
    },
    acceptOffer: async (assignmentId: string) => {
      const assignment = this.assignmentsMap.get(assignmentId);
      if (!assignment) throw new Error(`Assignment ${assignmentId} not found`);
      const updated = { ...assignment, status: 'accepted' as const, acceptedAt: this.nowIso() };
      this.assignmentsMap.set(assignmentId, updated);
      return updated;
    },
    declineOffer: async (assignmentId: string) => {
      const assignment = this.assignmentsMap.get(assignmentId);
      if (!assignment) throw new Error(`Assignment ${assignmentId} not found`);
      const updated = { ...assignment, status: 'declined' as const };
      this.assignmentsMap.set(assignmentId, updated);
      return updated;
    },
    supersede: async (assignmentId: string, status: 'reassigned' | 'cancelled') => {
      const assignment = this.assignmentsMap.get(assignmentId);
      if (!assignment) throw new Error(`Assignment ${assignmentId} not found`);
      const updated = { ...assignment, status };
      this.assignmentsMap.set(assignmentId, updated);
      return updated;
    },
    expireOffer: async (assignmentId: string) => {
      const assignment = this.assignmentsMap.get(assignmentId);
      if (!assignment) throw new Error(`Assignment ${assignmentId} not found`);
      const updated = { ...assignment, status: 'expired' as const };
      this.assignmentsMap.set(assignmentId, updated);
      return updated;
    },
  };

  statusEvents = {
    getByJobId: async (jobId: string) => this.statusEventRows.filter((e) => e.jobId === jobId),
    listAll: async () => [...this.statusEventRows],
  };

  travelMatrix = {
    getTravelMinutes: async (fromCluster: string, toCluster: string, isPeak = false) => {
      const entry = this.travelMatrixMap.get(`${fromCluster}_${toCluster}`);
      if (!entry) {
        throw new Error(`TRAVEL_MATRIX_MISSING:${fromCluster}->${toCluster}`);
      }
      return isPeak ? entry.peakMinutes : entry.minutes;
    },
    listAll: async () =>
      Array.from(this.travelMatrixMap.values()).sort(
        (a, b) => codePoint(a.fromCluster, b.fromCluster) || codePoint(a.toCluster, b.toCluster),
      ),
    setMatrix: async (
      entries: Array<{ fromCluster: string; toCluster: string; minutes: number; peakMinutes: number }>,
    ) => {
      for (const e of entries) {
        const record: TravelMatrix = {
          id: this.generateId('tm'),
          fromCluster: e.fromCluster,
          toCluster: e.toCluster,
          minutes: e.minutes,
          peakMinutes: e.peakMinutes,
          source: 'seeded',
          createdAt: this.nowIso(),
        };
        this.travelMatrixMap.set(`${e.fromCluster}_${e.toCluster}`, record);
      }
    },
  };

  boardSnapshots = {
    getLatestVersion: async () =>
      this.boardSnapshotRows.length > 0
        ? this.boardSnapshotRows[this.boardSnapshotRows.length - 1]!.version
        : 0,
    getLatest: async () =>
      this.boardSnapshotRows.length > 0
        ? this.boardSnapshotRows[this.boardSnapshotRows.length - 1]!
        : null,
    getSnapshot: async (version: number) =>
      this.boardSnapshotRows.find((s) => s.version === version) ?? null,
    createSnapshot: async (data: Record<string, unknown>, extra?: { sourceSnapshotId?: string; triggerEventId?: string }) => {
      const latest = await this.boardSnapshots.getLatest();
      if (extra?.sourceSnapshotId && latest && latest.id !== extra.sourceSnapshotId) {
        throw new StaleSnapshotError(extra.sourceSnapshotId);
      }
      const nextVersion = (latest?.version ?? 0) + 1;
      const snapshot: BoardSnapshot = {
        id: this.generateId('snp'),
        version: nextVersion,
        sourceSnapshotId: extra?.sourceSnapshotId,
        triggerEventId: extra?.triggerEventId,
        snapshotData: data,
        createdAt: this.nowIso(),
      };
      this.boardSnapshotRows.push(snapshot);
      return snapshot;
    },
  };

  decisionLogs = {
    getById: async (id: string) => this.decisionLogsMap.get(id) ?? null,
    // `sequence` is the explicit step order and wins; entries without one sort
    // last, then by timestamp. Mirrors the Postgres adapter's
    // `ORDER BY sequence ASC NULLS LAST, created_at ASC` exactly - the two
    // adapters must return the same order or the trace drawer lies.
    listByEvent: async (eventId: string) =>
      Array.from(this.decisionLogsMap.values())
        .filter((log) => log.eventId === eventId)
        .sort((a, b) => {
          const aSeq = a.sequence ?? Number.MAX_SAFE_INTEGER;
          const bSeq = b.sequence ?? Number.MAX_SAFE_INTEGER;
          if (aSeq !== bSeq) return aSeq - bSeq;
          return a.createdAt.localeCompare(b.createdAt);
        }),
    create: async (log: Omit<DecisionLog, 'id' | 'createdAt'>) => {
      const created: DecisionLog = { ...log, id: this.generateId('dlog'), createdAt: this.nowIso() };
      this.decisionLogsMap.set(created.id, created);
      return created;
    },
  };

  approvals = {
    getById: async (id: string) => this.approvalsMap.get(id) ?? null,
    listPending: async () => Array.from(this.approvalsMap.values()).filter((a) => a.status === 'pending'),
    // Each desk decision writes its own row, so the newest one is the live
    // verdict. Map preserves insertion order, which is creation order here.
    getByProposal: async (proposalId: string) => {
      const matches = Array.from(this.approvalsMap.values()).filter(
        (a) => a.proposalId === proposalId,
      );
      return matches[matches.length - 1] ?? null;
    },
    create: async (approval: Omit<Approval, 'id' | 'createdAt'>) => {
      const created: Approval = { ...approval, id: this.generateId('appr'), createdAt: this.nowIso() };
      this.approvalsMap.set(created.id, created);
      return created;
    },
    action: async (id: string, status: 'approved' | 'rejected', actionedBy: string, reason?: string) => {
      const approval = this.approvalsMap.get(id);
      if (!approval) throw new Error(`Approval ${id} not found`);
      const updated = {
        ...approval,
        status,
        actionedBy,
        actionedReason: reason,
        actionedAt: this.nowIso(),
      };
      this.approvalsMap.set(id, updated);
      return updated;
    },
  };

  events = {
    getById: async (id: string) => this.eventsMap.get(id) ?? null,
    create: async (event: Omit<OperationalEvent, 'id' | 'receivedAt'>) => {
      const created: OperationalEvent = {
        ...event,
        id: this.generateId('opev'),
        receivedAt: this.nowIso(),
      };
      this.eventsMap.set(created.id, created);
      return created;
    },
    updateStatus: async (id: string, status: OperationalEventStatus) => {
      const event = this.eventsMap.get(id);
      if (!event) throw new Error(`Event ${id} not found`);
      const updated = { ...event, status };
      this.eventsMap.set(id, updated);
      return updated;
    },
  };

  proposals = {
    getById: async (id: string) => this.proposalsMap.get(id) ?? null,
    getByEventId: async (eventId: string) =>
      Array.from(this.proposalsMap.values()).find((p) => p.eventId === eventId) ?? null,
    create: async (proposal: Omit<Proposal, 'id' | 'createdAt'>) => {
      const created: Proposal = { ...proposal, id: this.generateId('prop'), createdAt: this.nowIso() };
      this.proposalsMap.set(created.id, created);
      return created;
    },
    updateStatus: async (id: string, status: ProposalStatus, recommendedPlanId?: string) => {
      const proposal = this.proposalsMap.get(id);
      if (!proposal) throw new Error(`Proposal ${id} not found`);
      const updated = {
        ...proposal,
        status,
        recommendedPlanId: recommendedPlanId ?? proposal.recommendedPlanId,
      };
      this.proposalsMap.set(id, updated);
      return updated;
    },
  };

  candidatePlans = {
    getById: async (id: string) => this.candidatePlansMap.get(id) ?? null,
    listByProposal: async (proposalId: string) =>
      Array.from(this.candidatePlansMap.values()).filter((p) => p.proposalId === proposalId),
    create: async (plan: Omit<CandidatePlan, 'id' | 'createdAt'>) => {
      const created: CandidatePlan = { ...plan, id: this.generateId('plan'), createdAt: this.nowIso() };
      this.candidatePlansMap.set(created.id, created);
      return created;
    },
  };
}

export const dbDouble = new InMemoryDatabase();
