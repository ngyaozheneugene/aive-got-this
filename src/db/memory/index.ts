// Dispatch Coordinator Agent v0.4
// In-Memory Database Double Implementation
// Allows full offline testing of Stage A/B matching, Agent playbooks, and UI without RDS Postgres.

import { IDatabase } from '../interface';
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
  ScoreBreakdown,
  OperationalEvent,
  OperationalEventStatus,
  Proposal,
  ProposalStatus,
  CandidatePlan,
} from '../../shared/types/domain';

export class InMemoryDatabase implements IDatabase {
  private usersMap = new Map<string, AppUser>();
  private techniciansMap = new Map<string, Technician>();
  private certsMap = new Map<string, TechnicianCert>();
  private shiftsMap = new Map<string, Shift>(); // key: `${techId}_${date}`
  private customersMap = new Map<string, Customer>();
  private sitesMap = new Map<string, Site>();
  private siteMemoriesMap = new Map<string, SiteMemory>();
  private jobTypesMap = new Map<string, JobType>();
  private jobTypeCertsMap = new Map<string, JobTypeCert>();
  private jobsMap = new Map<string, Job>();
  private jobRequirementsMap = new Map<string, JobRequirement>();
  private assignmentsMap = new Map<string, Assignment>();
  private statusEvents: StatusEvent[] = [];
  private travelMatrixMap = new Map<string, TravelMatrix>(); // key: `${from}_${to}`
  private boardSnapshots: BoardSnapshot[] = [];
  private decisionLogsMap = new Map<string, DecisionLog>();
  private approvalsMap = new Map<string, Approval>();
  private eventsMap = new Map<string, OperationalEvent>();
  private proposalsMap = new Map<string, Proposal>();
  private candidatePlansMap = new Map<string, CandidatePlan>();

  private idCounter = 1;

  constructor() {
    this.seedDefaultCatalog();
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${(this.idCounter++).toString(36)}`;
  }

  private nowIso(): string {
    return new Date().toISOString();
  }

  public async reset(): Promise<void> {
    this.usersMap.clear();
    this.techniciansMap.clear();
    this.certsMap.clear();
    this.shiftsMap.clear();
    this.customersMap.clear();
    this.sitesMap.clear();
    this.siteMemoriesMap.clear();
    this.jobsMap.clear();
    this.jobRequirementsMap.clear();
    this.assignmentsMap.clear();
    this.statusEvents = [];
    this.travelMatrixMap.clear();
    this.boardSnapshots = [];
    this.decisionLogsMap.clear();
    this.approvalsMap.clear();
    this.eventsMap.clear();
    this.proposalsMap.clear();
    this.candidatePlansMap.clear();
    this.seedDefaultCatalog();
  }

  private seedDefaultCatalog(): void {
    // Seed default Job Types
    const defaultJobTypes: JobType[] = [
      { id: 'GENERAL_SERVICE', name: 'General Aircon Service & Wash', minTier: 1, difficulty: 1, defaultMinutes: 45, slaHours: 72, brandSensitive: false, createdAt: this.nowIso() },
      { id: 'WATER_LEAK', name: 'Water Leakage Repair', minTier: 2, difficulty: 2, defaultMinutes: 60, slaHours: 4, brandSensitive: false, createdAt: this.nowIso() },
      { id: 'REFRIGERANT_LEAK', name: 'R32 Gas Leak & Refill', minTier: 3, difficulty: 4, defaultMinutes: 90, slaHours: 3, brandSensitive: true, createdAt: this.nowIso() },
      { id: 'CHEMICAL_OVERHAUL', name: 'Chemical Overhaul', minTier: 3, difficulty: 3, defaultMinutes: 120, slaHours: 24, brandSensitive: false, createdAt: this.nowIso() },
      { id: 'INSTALL_OUTDOOR', name: 'HDB/Condo Outdoor Unit Installation', minTier: 2, difficulty: 4, defaultMinutes: 150, slaHours: 48, brandSensitive: false, createdAt: this.nowIso() },
      { id: 'VRV_ELECTRICAL_SIGN_OFF', name: 'VRV Electrical LEW Sign-off', minTier: 4, difficulty: 5, defaultMinutes: 60, slaHours: 24, brandSensitive: true, createdAt: this.nowIso() },
    ];
    defaultJobTypes.forEach(jt => this.jobTypesMap.set(jt.id, jt));

    // Seed default Job Type Certs
    const defaultJobTypeCerts: JobTypeCert[] = [
      { id: 'jtc_1', jobTypeId: 'REFRIGERANT_LEAK', certType: 'NEA_R32', brandRequired: false },
      { id: 'jtc_2', jobTypeId: 'INSTALL_OUTDOOR', certType: 'BCA_STRUCTURAL', brandRequired: false },
      { id: 'jtc_3', jobTypeId: 'VRV_ELECTRICAL_SIGN_OFF', certType: 'EMA_LEW', brandRequired: false },
    ];
    defaultJobTypeCerts.forEach(jtc => this.jobTypeCertsMap.set(jtc.id, jtc));
  }

  public async seed(data?: Record<string, unknown>): Promise<void> {
    if (!data) {
      this.seedDefault16Technicians();
      return;
    }
    // Custom seed loader implementation
    if (Array.isArray(data.technicians)) {
      (data.technicians as Technician[]).forEach(t => this.techniciansMap.set(t.id, t));
    }
    if (Array.isArray(data.certs)) {
      (data.certs as TechnicianCert[]).forEach(c => this.certsMap.set(c.id, c));
    }
  }

  private seedDefault16Technicians(): void {
    // Seed 16 Technicians matching evaluation requirements (including G-01 Bedok Daikin test case)
    const techs: Array<{ id: string; name: string; tier: 1 | 2 | 3 | 4; region: string; certs: Array<{ type: string; brand?: string; exp?: string }> }> = [
      { id: 'tech_wei', name: 'Wei', tier: 1, region: 'East', certs: [{ type: 'WSH_PASS' }, { type: 'NEA_R32', exp: '2025-01-01' }] }, // Expired R32
      { id: 'tech_ahmad', name: 'Ahmad', tier: 3, region: 'East', certs: [{ type: 'WSH_PASS' }, { type: 'NITEC_HVAC' }, { type: 'NEA_R32', brand: 'Daikin' }] },
      { id: 'tech_raj', name: 'Raj', tier: 3, region: 'East', certs: [{ type: 'WSH_PASS' }, { type: 'NITEC_HVAC' }, { type: 'NEA_R32' }] },
      { id: 'tech_mei', name: 'Mei', tier: 3, region: 'West', certs: [{ type: 'WSH_PASS' }, { type: 'NITEC_HVAC' }, { type: 'NEA_R32', brand: 'Daikin' }] },
      { id: 'tech_5', name: 'Seng', tier: 2, region: 'North', certs: [{ type: 'WSH_PASS' }, { type: 'BCA_STRUCTURAL' }] },
      { id: 'tech_6', name: 'Kumar', tier: 2, region: 'Central', certs: [{ type: 'WSH_PASS' }, { type: 'BCA_STRUCTURAL' }] },
      { id: 'tech_7', name: 'John', tier: 4, region: 'Central', certs: [{ type: 'WSH_PASS' }, { type: 'EMA_LEW' }] },
      { id: 'tech_8', name: 'Hassan', tier: 1, region: 'North-East', certs: [{ type: 'WSH_PASS' }] },
      { id: 'tech_9', name: 'Chen', tier: 2, region: 'East', certs: [{ type: 'WSH_PASS' }, { type: 'BCA_STRUCTURAL' }] },
      { id: 'tech_10', name: 'Devi', tier: 3, region: 'Central', certs: [{ type: 'WSH_PASS' }, { type: 'NEA_R32', brand: 'Mitsubishi' }] },
      { id: 'tech_11', name: 'Alvin', tier: 1, region: 'West', certs: [{ type: 'WSH_PASS' }] },
      { id: 'tech_12', name: 'Bala', tier: 2, region: 'South', certs: [{ type: 'WSH_PASS' }, { type: 'BCA_STRUCTURAL' }] },
      { id: 'tech_13', name: 'Ganesh', tier: 3, region: 'North', certs: [{ type: 'WSH_PASS' }, { type: 'NEA_R32', brand: 'Panasonic' }] },
      { id: 'tech_14', name: 'Dominic', tier: 1, region: 'Central', certs: [{ type: 'WSH_PASS' }] },
      { id: 'tech_15', name: 'Faizal', tier: 2, region: 'East', certs: [{ type: 'WSH_PASS' }, { type: 'BCA_STRUCTURAL' }] },
      { id: 'tech_16', name: 'Grace', tier: 3, region: 'West', certs: [{ type: 'WSH_PASS' }, { type: 'NEA_R32' }] },
    ];

    techs.forEach(t => {
      const techRecord: Technician = {
        id: t.id,
        name: t.name,
        tier: t.tier,
        homeRegion: t.region,
        currentCluster: t.region,
        maxMinutesDay: 480,
        acceptsOt: false,
        parts: [],
        tools: [],
        isActive: true,
        createdAt: this.nowIso(),
      };
      this.techniciansMap.set(t.id, techRecord);

      t.certs.forEach((c, idx) => {
        const certRecord: TechnicianCert = {
          id: `cert_${t.id}_${idx}`,
          technicianId: t.id,
          certType: c.type,
          brand: c.brand,
          issuedAt: '2024-01-01',
          expiresAt: c.exp,
          isLegalGate: ['NEA_R32', 'BCA_STRUCTURAL', 'EMA_LEW'].includes(c.type),
          createdAt: this.nowIso(),
        };
        this.certsMap.set(certRecord.id, certRecord);
      });
    });
  }

  // Users Implementation
  users = {
    getById: async (id: string) => this.usersMap.get(id) || null,
    getByCognitoSub: async (sub: string) => 
      Array.from(this.usersMap.values()).find(u => u.cognitoSub === sub) || null,
    getByDemoLogin: async (login: string) =>
      Array.from(this.usersMap.values()).find(u => u.demoLogin === login) || null,
    create: async (user: Omit<AppUser, 'id' | 'createdAt'>) => {
      const newUser: AppUser = { ...user, id: this.generateId('usr'), createdAt: this.nowIso() };
      this.usersMap.set(newUser.id, newUser);
      return newUser;
    },
  };

  // Technicians Implementation
  technicians = {
    getById: async (id: string) => this.techniciansMap.get(id) || null,
    listAll: async () => Array.from(this.techniciansMap.values()),
    listActive: async () => Array.from(this.techniciansMap.values()).filter(t => t.isActive),
    getCerts: async (technicianId: string) => 
      Array.from(this.certsMap.values()).filter(c => c.technicianId === technicianId),
    certValidOn: async (technicianId: string, certType: string, dateStr: string) => {
      const certs = Array.from(this.certsMap.values()).filter(
        c => c.technicianId === technicianId && c.certType === certType
      );
      const targetDate = new Date(dateStr);
      return certs.some(c => {
        const issued = new Date(c.issuedAt);
        if (issued > targetDate) return false;
        if (!c.expiresAt) return true;
        const expires = new Date(c.expiresAt);
        return expires >= targetDate;
      });
    },
    addCert: async (cert: Omit<TechnicianCert, 'id' | 'createdAt'>) => {
      const newCert: TechnicianCert = { ...cert, id: this.generateId('cert'), createdAt: this.nowIso() };
      this.certsMap.set(newCert.id, newCert);
      return newCert;
    },
    create: async (tech: Omit<Technician, 'id' | 'createdAt'>) => {
      const newTech: Technician = { ...tech, id: this.generateId('tech'), createdAt: this.nowIso() };
      this.techniciansMap.set(newTech.id, newTech);
      return newTech;
    },
  };

  // Shifts Implementation
  shifts = {
    getByTechAndDate: async (technicianId: string, dateStr: string) => {
      const key = `${technicianId}_${dateStr}`;
      return this.shiftsMap.get(key) || null;
    },
    clockIn: async (technicianId: string, dateStr: string) => {
      const key = `${technicianId}_${dateStr}`;
      const existing = this.shiftsMap.get(key);
      const updated: Shift = {
        id: existing?.id || this.generateId('shf'),
        technicianId,
        shiftDate: dateStr,
        status: 'clocked_in',
        clockInAt: this.nowIso(),
        clockOutAt: existing?.clockOutAt,
        createdAt: existing?.createdAt || this.nowIso(),
      };
      this.shiftsMap.set(key, updated);
      return updated;
    },
    clockOut: async (technicianId: string, dateStr: string) => {
      const key = `${technicianId}_${dateStr}`;
      const existing = this.shiftsMap.get(key);
      if (!existing) throw new Error(`Shift not found for technician ${technicianId} on ${dateStr}`);
      const updated: Shift = {
        ...existing,
        status: 'completed',
        clockOutAt: this.nowIso(),
      };
      this.shiftsMap.set(key, updated);
      return updated;
    },
    updateStatus: async (technicianId: string, dateStr: string, status: ShiftStatus) => {
      const key = `${technicianId}_${dateStr}`;
      const existing = this.shiftsMap.get(key);
      const updated: Shift = {
        id: existing?.id || this.generateId('shf'),
        technicianId,
        shiftDate: dateStr,
        status,
        clockInAt: existing?.clockInAt,
        clockOutAt: existing?.clockOutAt,
        createdAt: existing?.createdAt || this.nowIso(),
      };
      this.shiftsMap.set(key, updated);
      return updated;
    },
    listByDate: async (dateStr: string) => 
      Array.from(this.shiftsMap.values()).filter(s => s.shiftDate === dateStr),
  };

  // Customers Implementation
  customers = {
    getById: async (id: string) => this.customersMap.get(id) || null,
    getByPhone: async (phone: string) => 
      Array.from(this.customersMap.values()).find(c => c.phone === phone) || null,
    create: async (customer: Omit<Customer, 'id' | 'createdAt'>) => {
      const newCust: Customer = { ...customer, id: this.generateId('cust'), createdAt: this.nowIso() };
      this.customersMap.set(newCust.id, newCust);
      return newCust;
    },
  };

  // Sites Implementation
  sites = {
    getById: async (id: string) => this.sitesMap.get(id) || null,
    getByCustomerId: async (customerId: string) => 
      Array.from(this.sitesMap.values()).filter(s => s.customerId === customerId),
    getByPostalCode: async (postalCode: string) => 
      Array.from(this.sitesMap.values()).find(s => s.postalCode === postalCode) || null,
    create: async (site: Omit<Site, 'id' | 'createdAt'>) => {
      const newSite: Site = { ...site, id: this.generateId('site'), createdAt: this.nowIso() };
      this.sitesMap.set(newSite.id, newSite);
      return newSite;
    },
  };

  siteMemories = {
    getBySiteId: async (siteId: string) => 
      Array.from(this.siteMemoriesMap.values()).filter(m => m.siteId === siteId),
    addNote: async (note: Omit<SiteMemory, 'id' | 'createdAt'>) => {
      const newNote: SiteMemory = { ...note, id: this.generateId('mem'), createdAt: this.nowIso() };
      this.siteMemoriesMap.set(newNote.id, newNote);
      return newNote;
    },
  };

  // Job Types Implementation
  jobTypes = {
    getById: async (id: string) => this.jobTypesMap.get(id) || null,
    listAll: async () => Array.from(this.jobTypesMap.values()),
    getCerts: async (jobTypeId: string) => 
      Array.from(this.jobTypeCertsMap.values()).filter(c => c.jobTypeId === jobTypeId),
  };

  // Jobs Implementation
  jobs = {
    getById: async (id: string) => this.jobsMap.get(id) || null,
    create: async (job: Omit<Job, 'id' | 'createdAt' | 'updatedAt'>) => {
      const now = this.nowIso();
      const newJob: Job = { ...job, id: this.generateId('job'), createdAt: now, updatedAt: now };
      this.jobsMap.set(newJob.id, newJob);
      return newJob;
    },
    updateStatus: async (jobId: string, status: JobStatus, actorId: string, actorRole: string, reason?: string) => {
      const job = this.jobsMap.get(jobId);
      if (!job) throw new Error(`Job ${jobId} not found`);
      const fromStatus = job.status;
      job.status = status;
      job.updatedAt = this.nowIso();
      this.jobsMap.set(jobId, job);

      // Log status event (Dispatch writer pattern)
      const event: StatusEvent = {
        id: this.generateId('evt'),
        jobId,
        fromStatus,
        toStatus: status,
        actorId,
        actorRole,
        reason,
        createdAt: this.nowIso(),
      };
      this.statusEvents.push(event);
      return job;
    },
    listUnassigned: async () => 
      Array.from(this.jobsMap.values()).filter(j => j.status === 'unassigned' || j.status === 'received'),
    listByScheduledDate: async (dateStr: string) => 
      Array.from(this.jobsMap.values()).filter(j => j.scheduledDate === dateStr),
  };

  jobRequirements = {
    getByJobId: async (jobId: string) => 
      Array.from(this.jobRequirementsMap.values()).find(r => r.jobId === jobId) || null,
    create: async (req: Omit<JobRequirement, 'id' | 'createdAt'>) => {
      const newReq: JobRequirement = { ...req, id: this.generateId('jreq'), createdAt: this.nowIso() };
      this.jobRequirementsMap.set(newReq.id, newReq);
      return newReq;
    },
  };

  // Assignments Implementation
  assignments = {
    getById: async (id: string) => this.assignmentsMap.get(id) || null,
    getByJobId: async (jobId: string) => 
      Array.from(this.assignmentsMap.values()).filter(a => a.jobId === jobId),
    getActiveForTechnician: async (technicianId: string, dateStr: string) => {
      const techJobs = Array.from(this.jobsMap.values()).filter(j => j.scheduledDate === dateStr);
      const jobIds = new Set(techJobs.map(j => j.id));
      return Array.from(this.assignmentsMap.values()).filter(
        a => a.technicianId === technicianId && jobIds.has(a.jobId) && (a.status === 'accepted' || a.status === 'offered')
      );
    },
    createOffer: async (params: {
      jobId: string;
      technicianId: string;
      snapshotId: string;
      expiresInMinutes?: number;
      scoreBreakdown: ScoreBreakdown;
      decisionLogId?: string;
    }) => {
      const expiresMinutes = params.expiresInMinutes || 10;
      const now = new Date();
      const expires = new Date(now.getTime() + expiresMinutes * 60 * 1000);
      const newAssignment: Assignment = {
        id: this.generateId('asg'),
        jobId: params.jobId,
        technicianId: params.technicianId,
        status: 'offered',
        snapshotId: params.snapshotId,
        offeredAt: now.toISOString(),
        expiresAt: expires.toISOString(),
        scoreBreakdown: params.scoreBreakdown,
        decisionLogId: params.decisionLogId,
      };
      this.assignmentsMap.set(newAssignment.id, newAssignment);
      return newAssignment;
    },
    acceptOffer: async (assignmentId: string) => {
      const assignment = this.assignmentsMap.get(assignmentId);
      if (!assignment) throw new Error(`Assignment ${assignmentId} not found`);
      assignment.status = 'accepted';
      assignment.acceptedAt = this.nowIso();
      this.assignmentsMap.set(assignmentId, assignment);
      return assignment;
    },
    declineOffer: async (assignmentId: string) => {
      const assignment = this.assignmentsMap.get(assignmentId);
      if (!assignment) throw new Error(`Assignment ${assignmentId} not found`);
      assignment.status = 'declined';
      this.assignmentsMap.set(assignmentId, assignment);
      return assignment;
    },
    expireOffer: async (assignmentId: string) => {
      const assignment = this.assignmentsMap.get(assignmentId);
      if (!assignment) throw new Error(`Assignment ${assignmentId} not found`);
      assignment.status = 'expired';
      this.assignmentsMap.set(assignmentId, assignment);
      return assignment;
    },
  };

  // Status Events Implementation
  statusEventsImpl = {
    getByJobId: async (jobId: string) => this.statusEvents.filter(e => e.jobId === jobId),
    listAll: async () => [...this.statusEvents],
  };
  get statusEventsApi() { return this.statusEventsImpl; }
  get statusEvents() { return this.statusEventsImpl as unknown as StatusEvent[]; }

  // Travel Matrix Implementation
  travelMatrix = {
    getTravelMinutes: async (fromCluster: string, toCluster: string, isPeak: boolean = false) => {
      if (fromCluster === toCluster) return 5;
      const key = `${fromCluster}_${toCluster}`;
      const entry = this.travelMatrixMap.get(key);
      if (!entry) return 20; // Default flat 20 minute travel in Week 1 live path
      return isPeak ? entry.peakMinutes : entry.minutes;
    },
    setMatrix: async (entries: Array<{ fromCluster: string; toCluster: string; minutes: number; peakMinutes: number }>) => {
      entries.forEach(e => {
        const key = `${e.fromCluster}_${e.toCluster}`;
        const record: TravelMatrix = {
          id: this.generateId('tm'),
          fromCluster: e.fromCluster,
          toCluster: e.toCluster,
          minutes: e.minutes,
          peakMinutes: e.peakMinutes,
          source: 'seeded',
          createdAt: this.nowIso(),
        };
        this.travelMatrixMap.set(key, record);
      });
    },
  };

  // Snapshots & Decision Logs Implementation
  boardSnapshots = {
    getLatestVersion: async () => this.boardSnapshots.length > 0 ? this.boardSnapshots[this.boardSnapshots.length - 1].version : 0,
    getSnapshot: async (version: number) => this.boardSnapshots.find(s => s.version === version) || null,
    createSnapshot: async (data: Record<string, unknown>) => {
      const nextVersion = this.boardSnapshots.length + 1;
      const snapshot: BoardSnapshot = {
        id: this.generateId('snp'),
        version: nextVersion,
        snapshotData: data,
        createdAt: this.nowIso(),
      };
      this.boardSnapshots.push(snapshot);
      return snapshot;
    },
  };

  decisionLogs = {
    getById: async (id: string) => this.decisionLogsMap.get(id) || null,
    create: async (log: Omit<DecisionLog, 'id' | 'createdAt'>) => {
      const newLog: DecisionLog = { ...log, id: this.generateId('dlog'), createdAt: this.nowIso() };
      this.decisionLogsMap.set(newLog.id, newLog);
      return newLog;
    },
  };

  // Approvals Implementation
  approvals = {
    getById: async (id: string) => this.approvalsMap.get(id) || null,
    listPending: async () => Array.from(this.approvalsMap.values()).filter(a => a.status === 'pending'),
    create: async (approval: Omit<Approval, 'id' | 'createdAt'>) => {
      const newApproval: Approval = { ...approval, id: this.generateId('appr'), createdAt: this.nowIso() };
      this.approvalsMap.set(newApproval.id, newApproval);
      return newApproval;
    },
    action: async (id: string, status: 'approved' | 'rejected', actionedBy: string, reason?: string) => {
      const approval = this.approvalsMap.get(id);
      if (!approval) throw new Error(`Approval card ${id} not found`);
      approval.status = status;
      approval.actionedBy = actionedBy;
      approval.actionedReason = reason;
      approval.actionedAt = this.nowIso();
      this.approvalsMap.set(id, approval);
      return approval;
    },
  };

  events = {
    getById: async (id: string) => this.eventsMap.get(id) || null,
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
      event.status = status;
      this.eventsMap.set(id, event);
      return event;
    },
  };

  proposals = {
    getById: async (id: string) => this.proposalsMap.get(id) || null,
    getByEventId: async (eventId: string) =>
      Array.from(this.proposalsMap.values()).find(p => p.eventId === eventId) || null,
    create: async (proposal: Omit<Proposal, 'id' | 'createdAt'>) => {
      const created: Proposal = { ...proposal, id: this.generateId('prop'), createdAt: this.nowIso() };
      this.proposalsMap.set(created.id, created);
      return created;
    },
    updateStatus: async (id: string, status: ProposalStatus, recommendedPlanId?: string) => {
      const proposal = this.proposalsMap.get(id);
      if (!proposal) throw new Error(`Proposal ${id} not found`);
      proposal.status = status;
      if (recommendedPlanId) proposal.recommendedPlanId = recommendedPlanId;
      this.proposalsMap.set(id, proposal);
      return proposal;
    },
  };

  candidatePlans = {
    getById: async (id: string) => this.candidatePlansMap.get(id) || null,
    listByProposal: async (proposalId: string) =>
      Array.from(this.candidatePlansMap.values()).filter(p => p.proposalId === proposalId),
    create: async (plan: Omit<CandidatePlan, 'id' | 'createdAt'>) => {
      const created: CandidatePlan = { ...plan, id: this.generateId('plan'), createdAt: this.nowIso() };
      this.candidatePlansMap.set(created.id, created);
      return created;
    },
  };
}

// Export singleton instance for immediate testing
export const dbDouble = new InMemoryDatabase();
