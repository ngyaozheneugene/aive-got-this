// Dispatch Coordinator v1.1
// Postgres client. Local Compose or the Lightsail volume — not RDS.

import postgres from 'postgres';
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
  emptyPlanMetrics,
} from '../../shared/types/domain';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://dispatch:dispatch@localhost:5432/dispatch';

export class PostgresDatabase {
  private sql: postgres.Sql;

  constructor(connectionString?: string) {
    this.sql = postgres(connectionString || DATABASE_URL, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }

  public async reset(): Promise<void> {
    await this.sql`TRUNCATE TABLE
      candidate_plan, approval, proposal, decision_log, operational_event, board_snapshot,
      status_event, assignment, job_requirement, job, site_memory, recurrence, site, customer,
      shift, technician_cert, technician, app_user, travel_matrix, intake_message, dispatch_policy
      RESTART IDENTITY CASCADE`;
  }

  public async seed(): Promise<void> {
    // Seed execution against PostgreSQL SQL script
  }

  // Users Implementation
  users = {
    getById: async (id: string) => {
      const rows = await this.sql<AppUser[]>`SELECT id, demo_login as "demoLogin", cognito_sub as "cognitoSub", role, name, email, phone, created_at as "createdAt" FROM app_user WHERE id = ${id}`;
      return rows[0] || null;
    },
    getByCognitoSub: async (sub: string) => {
      const rows = await this.sql<AppUser[]>`SELECT id, demo_login as "demoLogin", cognito_sub as "cognitoSub", role, name, email, phone, created_at as "createdAt" FROM app_user WHERE cognito_sub = ${sub}`;
      return rows[0] || null;
    },
    getByDemoLogin: async (login: string) => {
      const rows = await this.sql<AppUser[]>`SELECT id, demo_login as "demoLogin", cognito_sub as "cognitoSub", role, name, email, phone, created_at as "createdAt" FROM app_user WHERE demo_login = ${login}`;
      return rows[0] || null;
    },
    create: async (user: Omit<AppUser, 'id' | 'createdAt'>) => {
      const rows = await this.sql<AppUser[]>`
        INSERT INTO app_user (demo_login, cognito_sub, role, name, email, phone)
        VALUES (${user.demoLogin || null}, ${user.cognitoSub || null}, ${user.role}, ${user.name}, ${user.email || null}, ${user.phone || null})
        RETURNING id, demo_login as "demoLogin", cognito_sub as "cognitoSub", role, name, email, phone, created_at as "createdAt"
      `;
      return rows[0];
    },
  };

  // Technicians Implementation
  technicians = {
    getById: async (id: string) => {
      const rows = await this.sql<Technician[]>`
        SELECT id, user_id as "userId", name, tier, home_region as "homeRegion", current_cluster as "currentCluster", max_minutes_day as "maxMinutesDay", accepts_ot as "acceptsOt", parts, tools, is_active as "isActive", created_at as "createdAt"
        FROM technician WHERE id = ${id}
      `;
      return rows[0] || null;
    },
    listAll: async () => {
      return await this.sql<Technician[]>`
        SELECT id, user_id as "userId", name, tier, home_region as "homeRegion", current_cluster as "currentCluster", max_minutes_day as "maxMinutesDay", accepts_ot as "acceptsOt", parts, tools, is_active as "isActive", created_at as "createdAt"
        FROM technician
      `;
    },
    listActive: async () => {
      return await this.sql<Technician[]>`
        SELECT id, user_id as "userId", name, tier, home_region as "homeRegion", current_cluster as "currentCluster", max_minutes_day as "maxMinutesDay", accepts_ot as "acceptsOt", parts, tools, is_active as "isActive", created_at as "createdAt"
        FROM technician WHERE is_active = true
      `;
    },
    getCerts: async (technicianId: string) => {
      return await this.sql<TechnicianCert[]>`
        SELECT id, technician_id as "technicianId", cert_type as "certType", brand, issued_at as "issuedAt", expires_at as "expiresAt", is_legal_gate as "isLegalGate", created_at as "createdAt"
        FROM technician_cert WHERE technician_id = ${technicianId}
      `;
    },
    certValidOn: async (technicianId: string, certType: string, dateStr: string) => {
      const rows = await this.sql<{ valid: boolean }[]>`
        SELECT cert_valid_on(${technicianId}, ${certType}, ${dateStr}::date) as valid
      `;
      return rows[0]?.valid || false;
    },
    addCert: async (cert: Omit<TechnicianCert, 'id' | 'createdAt'>) => {
      const rows = await this.sql<TechnicianCert[]>`
        INSERT INTO technician_cert (technician_id, cert_type, brand, issued_at, expires_at, is_legal_gate)
        VALUES (${cert.technicianId}, ${cert.certType}, ${cert.brand || null}, ${cert.issuedAt}::date, ${cert.expiresAt ? cert.expiresAt : null}::date, ${cert.isLegalGate})
        RETURNING id, technician_id as "technicianId", cert_type as "certType", brand, issued_at as "issuedAt", expires_at as "expiresAt", is_legal_gate as "isLegalGate", created_at as "createdAt"
      `;
      return rows[0];
    },
    create: async (tech: Omit<Technician, 'id' | 'createdAt'>) => {
      const rows = await this.sql<Technician[]>`
        INSERT INTO technician (user_id, name, tier, home_region, current_cluster, max_minutes_day, accepts_ot, parts, tools, is_active)
        VALUES (${tech.userId || null}, ${tech.name}, ${tech.tier}, ${tech.homeRegion}, ${tech.currentCluster || tech.homeRegion}, ${tech.maxMinutesDay}, ${tech.acceptsOt}, ${tech.parts || []}, ${tech.tools || []}, ${tech.isActive})
        RETURNING id, user_id as "userId", name, tier, home_region as "homeRegion", current_cluster as "currentCluster", max_minutes_day as "maxMinutesDay", accepts_ot as "acceptsOt", parts, tools, is_active as "isActive", created_at as "createdAt"
      `;
      return rows[0];
    },
  };

  // Shifts Implementation
  shifts = {
    getByTechAndDate: async (technicianId: string, dateStr: string) => {
      const rows = await this.sql<Shift[]>`
        SELECT id, technician_id as "technicianId", shift_date as "shiftDate", status, clock_in_at as "clockInAt", clock_out_at as "clockOutAt", created_at as "createdAt"
        FROM shift WHERE technician_id = ${technicianId} AND shift_date = ${dateStr}::date
      `;
      return rows[0] || null;
    },
    clockIn: async (technicianId: string, dateStr: string) => {
      const rows = await this.sql<Shift[]>`
        INSERT INTO shift (technician_id, shift_date, status, clock_in_at)
        VALUES (${technicianId}, ${dateStr}::date, 'clocked_in', NOW())
        ON CONFLICT (technician_id, shift_date) DO UPDATE SET status = 'clocked_in', clock_in_at = NOW()
        RETURNING id, technician_id as "technicianId", shift_date as "shiftDate", status, clock_in_at as "clockInAt", clock_out_at as "clockOutAt", created_at as "createdAt"
      `;
      return rows[0];
    },
    clockOut: async (technicianId: string, dateStr: string) => {
      const rows = await this.sql<Shift[]>`
        UPDATE shift SET status = 'completed', clock_out_at = NOW()
        WHERE technician_id = ${technicianId} AND shift_date = ${dateStr}::date
        RETURNING id, technician_id as "technicianId", shift_date as "shiftDate", status, clock_in_at as "clockInAt", clock_out_at as "clockOutAt", created_at as "createdAt"
      `;
      return rows[0];
    },
    updateStatus: async (technicianId: string, dateStr: string, status: ShiftStatus) => {
      const rows = await this.sql<Shift[]>`
        INSERT INTO shift (technician_id, shift_date, status)
        VALUES (${technicianId}, ${dateStr}::date, ${status})
        ON CONFLICT (technician_id, shift_date) DO UPDATE SET status = ${status}
        RETURNING id, technician_id as "technicianId", shift_date as "shiftDate", status, clock_in_at as "clockInAt", clock_out_at as "clockOutAt", created_at as "createdAt"
      `;
      return rows[0];
    },
    listByDate: async (dateStr: string) => {
      return await this.sql<Shift[]>`
        SELECT id, technician_id as "technicianId", shift_date as "shiftDate", status, clock_in_at as "clockInAt", clock_out_at as "clockOutAt", created_at as "createdAt"
        FROM shift WHERE shift_date = ${dateStr}::date
      `;
    },
  };

  // Customers Implementation
  customers = {
    getById: async (id: string) => {
      const rows = await this.sql<Customer[]>`SELECT id, name, phone, email, company_name as "companyName", created_at as "createdAt" FROM customer WHERE id = ${id}`;
      return rows[0] || null;
    },
    getByPhone: async (phone: string) => {
      const rows = await this.sql<Customer[]>`SELECT id, name, phone, email, company_name as "companyName", created_at as "createdAt" FROM customer WHERE phone = ${phone}`;
      return rows[0] || null;
    },
    create: async (customer: Omit<Customer, 'id' | 'createdAt'>) => {
      const rows = await this.sql<Customer[]>`
        INSERT INTO customer (name, phone, email, company_name)
        VALUES (${customer.name}, ${customer.phone}, ${customer.email || null}, ${customer.companyName || null})
        RETURNING id, name, phone, email, company_name as "companyName", created_at as "createdAt"
      `;
      return rows[0];
    },
  };

  // Sites Implementation
  sites = {
    getById: async (id: string) => {
      const rows = await this.sql<Site[]>`SELECT id, customer_id as "customerId", postal_code as "postalCode", region, estate_cluster as "estateCluster", address_line1 as "addressLine1", unit_no as "unitNo", access_flags as "accessFlags", created_at as "createdAt" FROM site WHERE id = ${id}`;
      return rows[0] || null;
    },
    getByCustomerId: async (customerId: string) => {
      return await this.sql<Site[]>`SELECT id, customer_id as "customerId", postal_code as "postalCode", region, estate_cluster as "estateCluster", address_line1 as "addressLine1", unit_no as "unitNo", access_flags as "accessFlags", created_at as "createdAt" FROM site WHERE customer_id = ${customerId}`;
    },
    getByPostalCode: async (postalCode: string) => {
      const rows = await this.sql<Site[]>`SELECT id, customer_id as "customerId", postal_code as "postalCode", region, estate_cluster as "estateCluster", address_line1 as "addressLine1", unit_no as "unitNo", access_flags as "accessFlags", created_at as "createdAt" FROM site WHERE postal_code = ${postalCode}`;
      return rows[0] || null;
    },
    create: async (site: Omit<Site, 'id' | 'createdAt'>) => {
      const rows = await this.sql<Site[]>`
        INSERT INTO site (customer_id, postal_code, region, estate_cluster, address_line1, unit_no, access_flags)
        VALUES (${site.customerId}, ${site.postalCode}, ${site.region}, ${site.estateCluster}, ${site.addressLine1}, ${site.unitNo}, ${site.accessFlags || []})
        RETURNING id, customer_id as "customerId", postal_code as "postalCode", region, estate_cluster as "estateCluster", address_line1 as "addressLine1", unit_no as "unitNo", access_flags as "accessFlags", created_at as "createdAt"
      `;
      return rows[0];
    },
  };

  siteMemories = {
    getBySiteId: async (siteId: string) => {
      return await this.sql<SiteMemory[]>`SELECT id, site_id as "siteId", job_id as "jobId", technician_id as "technicianId", note_raw as "noteRaw", created_at as "createdAt" FROM site_memory WHERE site_id = ${siteId}`;
    },
    addNote: async (note: Omit<SiteMemory, 'id' | 'createdAt'>) => {
      const rows = await this.sql<SiteMemory[]>`
        INSERT INTO site_memory (site_id, job_id, technician_id, note_raw)
        VALUES (${note.siteId}, ${note.jobId || null}, ${note.technicianId || null}, ${note.noteRaw})
        RETURNING id, site_id as "siteId", job_id as "jobId", technician_id as "technicianId", note_raw as "noteRaw", created_at as "createdAt"
      `;
      return rows[0];
    },
  };

  // Job Types Implementation
  jobTypes = {
    getById: async (id: string) => {
      const rows = await this.sql<JobType[]>`SELECT id, name, min_tier as "minTier", difficulty, default_minutes as "defaultMinutes", sla_hours as "slaHours", brand_sensitive as "brandSensitive", created_at as "createdAt" FROM job_type WHERE id = ${id}`;
      return rows[0] || null;
    },
    listAll: async () => {
      return await this.sql<JobType[]>`SELECT id, name, min_tier as "minTier", difficulty, default_minutes as "defaultMinutes", sla_hours as "slaHours", brand_sensitive as "brandSensitive", created_at as "createdAt" FROM job_type`;
    },
    getCerts: async (jobTypeId: string) => {
      return await this.sql<JobTypeCert[]>`SELECT id, job_type_id as "jobTypeId", cert_type as "certType", brand_required as "brandRequired" FROM job_type_cert WHERE job_type_id = ${jobTypeId}`;
    },
  };

  // Jobs Implementation
  jobs = {
    getById: async (id: string) => {
      const rows = await this.sql<Job[]>`SELECT id, customer_id as "customerId", site_id as "siteId", job_type_id as "jobTypeId", status, priority, window_type as "windowType", lock_state as "lockState", scheduled_date as "scheduledDate", window_start as "windowStart", window_end as "windowEnd", duration_minutes as "durationMinutes", parts_required as "partsRequired", tools_required as "toolsRequired", note_raw as "noteRaw", required_crew_size as "requiredCrewSize", board_version_at_rank as "boardVersionAtRank", confidence_score as "confidenceScore", created_at as "createdAt", updated_at as "updatedAt" FROM job WHERE id = ${id}`;
      return rows[0] || null;
    },
    create: async (job: Omit<Job, 'id' | 'createdAt' | 'updatedAt'>) => {
      const rows = await this.sql<Job[]>`
        INSERT INTO job (customer_id, site_id, job_type_id, status, priority, window_type, lock_state, scheduled_date, window_start, window_end, duration_minutes, parts_required, tools_required, note_raw, required_crew_size, board_version_at_rank, confidence_score)
        VALUES (${job.customerId}, ${job.siteId}, ${job.jobTypeId}, ${job.status}, ${job.priority}, ${job.windowType}, ${job.lockState || 'none'}, ${job.scheduledDate}::date, ${job.windowStart || null}, ${job.windowEnd || null}, ${job.durationMinutes || 60}, ${job.partsRequired || []}, ${job.toolsRequired || []}, ${job.noteRaw}, ${job.requiredCrewSize}, ${job.boardVersionAtRank}, ${job.confidenceScore})
        RETURNING id, customer_id as "customerId", site_id as "siteId", job_type_id as "jobTypeId", status, priority, window_type as "windowType", lock_state as "lockState", scheduled_date as "scheduledDate", window_start as "windowStart", window_end as "windowEnd", duration_minutes as "durationMinutes", parts_required as "partsRequired", tools_required as "toolsRequired", note_raw as "noteRaw", required_crew_size as "requiredCrewSize", board_version_at_rank as "boardVersionAtRank", confidence_score as "confidenceScore", created_at as "createdAt", updated_at as "updatedAt"
      `;
      return rows[0];
    },
    updateStatus: async (jobId: string, status: JobStatus, actorId: string, actorRole: string, reason?: string) => {
      const oldJob = await this.jobs.getById(jobId);
      if (!oldJob) throw new Error(`Job ${jobId} not found`);

      const rows = await this.sql<Job[]>`
        UPDATE job SET status = ${status}, updated_at = NOW() WHERE id = ${jobId}
        RETURNING id, customer_id as "customerId", site_id as "siteId", job_type_id as "jobTypeId", status, priority, window_type as "windowType", lock_state as "lockState", scheduled_date as "scheduledDate", window_start as "windowStart", window_end as "windowEnd", duration_minutes as "durationMinutes", parts_required as "partsRequired", tools_required as "toolsRequired", note_raw as "noteRaw", required_crew_size as "requiredCrewSize", board_version_at_rank as "boardVersionAtRank", confidence_score as "confidenceScore", created_at as "createdAt", updated_at as "updatedAt"
      `;
      // Dispatch status event log
      await this.sql`
        INSERT INTO status_event (job_id, from_status, to_status, actor_id, actor_role, reason)
        VALUES (${jobId}, ${oldJob.status}, ${status}, ${actorId}, ${actorRole}, ${reason || null})
      `;
      return rows[0];
    },
    listUnassigned: async () => {
      return await this.sql<Job[]>`SELECT id, customer_id as "customerId", site_id as "siteId", job_type_id as "jobTypeId", status, priority, window_type as "windowType", lock_state as "lockState", scheduled_date as "scheduledDate", window_start as "windowStart", window_end as "windowEnd", duration_minutes as "durationMinutes", parts_required as "partsRequired", tools_required as "toolsRequired", note_raw as "noteRaw", required_crew_size as "requiredCrewSize", board_version_at_rank as "boardVersionAtRank", confidence_score as "confidenceScore", created_at as "createdAt", updated_at as "updatedAt" FROM job WHERE status IN ('unassigned', 'received')`;
    },
    listByScheduledDate: async (dateStr: string) => {
      return await this.sql<Job[]>`SELECT id, customer_id as "customerId", site_id as "siteId", job_type_id as "jobTypeId", status, priority, window_type as "windowType", lock_state as "lockState", scheduled_date as "scheduledDate", window_start as "windowStart", window_end as "windowEnd", duration_minutes as "durationMinutes", parts_required as "partsRequired", tools_required as "toolsRequired", note_raw as "noteRaw", required_crew_size as "requiredCrewSize", board_version_at_rank as "boardVersionAtRank", confidence_score as "confidenceScore", created_at as "createdAt", updated_at as "updatedAt" FROM job WHERE scheduled_date = ${dateStr}::date`;
    },
  };

  jobRequirements = {
    getByJobId: async (jobId: string) => {
      const rows = await this.sql<JobRequirement[]>`SELECT id, job_id as "jobId", min_tier as "minTier", required_certs as "requiredCerts", brand_required as "brandRequired", required_crew_size as "requiredCrewSize", created_at as "createdAt" FROM job_requirement WHERE job_id = ${jobId}`;
      return rows[0] || null;
    },
    create: async (req: Omit<JobRequirement, 'id' | 'createdAt'>) => {
      const rows = await this.sql<JobRequirement[]>`
        INSERT INTO job_requirement (job_id, min_tier, required_certs, brand_required, required_crew_size)
        VALUES (${req.jobId}, ${req.minTier}, ${req.requiredCerts}, ${req.brandRequired || null}, ${req.requiredCrewSize})
        RETURNING id, job_id as "jobId", min_tier as "minTier", required_certs as "requiredCerts", brand_required as "brandRequired", required_crew_size as "requiredCrewSize", created_at as "createdAt"
      `;
      return rows[0];
    },
  };

  // Assignments Implementation
  assignments = {
    getById: async (id: string) => {
      const rows = await this.sql<Assignment[]>`SELECT id, job_id as "jobId", technician_id as "technicianId", status, snapshot_id as "snapshotId", offered_at as "offeredAt", expires_at as "expiresAt", accepted_at as "acceptedAt", score_breakdown as "metrics" FROM assignment WHERE id = ${id}`;
      return rows[0] || null;
    },
    getByJobId: async (jobId: string) => {
      return await this.sql<Assignment[]>`SELECT id, job_id as "jobId", technician_id as "technicianId", status, snapshot_id as "snapshotId", offered_at as "offeredAt", expires_at as "expiresAt", accepted_at as "acceptedAt", score_breakdown as "metrics" FROM assignment WHERE job_id = ${jobId}`;
    },
    getActiveForTechnician: async (technicianId: string, dateStr: string) => {
      return await this.sql<Assignment[]>`
        SELECT a.id, a.job_id as "jobId", a.technician_id as "technicianId", a.status, a.snapshot_id as "snapshotId", a.offered_at as "offeredAt", a.expires_at as "expiresAt", a.accepted_at as "acceptedAt", a.score_breakdown as "metrics"
        FROM assignment a
        JOIN job j ON a.job_id = j.id
        WHERE a.technician_id = ${technicianId} AND j.scheduled_date = ${dateStr}::date AND a.status IN ('offered', 'accepted')
      `;
    },
    listAll: async () => {
      return await this.sql<Assignment[]>`SELECT id, job_id as "jobId", technician_id as "technicianId", status, snapshot_id as "snapshotId", offered_at as "offeredAt", expires_at as "expiresAt", accepted_at as "acceptedAt", score_breakdown as "metrics" FROM assignment`;
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
      const metrics = params.metrics ?? emptyPlanMetrics();
      const rows = await this.sql<Assignment[]>`
        INSERT INTO assignment (job_id, technician_id, snapshot_id, status, window_start, window_end, travel_before_minutes, offered_at, accepted_at, score_breakdown)
        VALUES (${params.jobId}, ${params.technicianId}, ${params.snapshotId}, 'accepted', ${params.windowStart || null}, ${params.windowEnd || null}, ${params.travelBeforeMinutes ?? null}, NOW(), NOW(), ${JSON.stringify(metrics)})
        RETURNING id, job_id as "jobId", technician_id as "technicianId", status, snapshot_id as "snapshotId", offered_at as "offeredAt", expires_at as "expiresAt", accepted_at as "acceptedAt", score_breakdown as "metrics"
      `;
      return rows[0];
    },
    createOffer: async (params: {
      jobId: string;
      technicianId: string;
      snapshotId: string;
      expiresInMinutes?: number;
      metrics?: PlanMetrics;
      decisionLogId?: string;
    }) => {
      const minutes = params.expiresInMinutes || 10;
      const metrics = params.metrics ?? emptyPlanMetrics();
      const rows = await this.sql<Assignment[]>`
        INSERT INTO assignment (job_id, technician_id, snapshot_id, offered_at, expires_at, score_breakdown, decision_log_id)
        VALUES (${params.jobId}, ${params.technicianId}, ${params.snapshotId}, NOW(), NOW() + ${minutes + ' minutes'}::interval, ${JSON.stringify(metrics)}, ${params.decisionLogId || null})
        RETURNING id, job_id as "jobId", technician_id as "technicianId", status, snapshot_id as "snapshotId", offered_at as "offeredAt", expires_at as "expiresAt", accepted_at as "acceptedAt", score_breakdown as "metrics"
      `;
      return rows[0];
    },
    acceptOffer: async (assignmentId: string) => {
      const rows = await this.sql<Assignment[]>`
        UPDATE assignment SET status = 'accepted', accepted_at = NOW() WHERE id = ${assignmentId}
        RETURNING id, job_id as "jobId", technician_id as "technicianId", status, snapshot_id as "snapshotId", offered_at as "offeredAt", expires_at as "expiresAt", accepted_at as "acceptedAt", score_breakdown as "metrics"
      `;
      return rows[0];
    },
    declineOffer: async (assignmentId: string) => {
      const rows = await this.sql<Assignment[]>`
        UPDATE assignment SET status = 'declined' WHERE id = ${assignmentId}
        RETURNING id, job_id as "jobId", technician_id as "technicianId", status, snapshot_id as "snapshotId", offered_at as "offeredAt", expires_at as "expiresAt", accepted_at as "acceptedAt", score_breakdown as "metrics"
      `;
      return rows[0];
    },
    supersede: async (assignmentId: string, status: 'reassigned' | 'cancelled') => {
      const rows = await this.sql<Assignment[]>`
        UPDATE assignment SET status = ${status} WHERE id = ${assignmentId}
        RETURNING id, job_id as "jobId", technician_id as "technicianId", status, snapshot_id as "snapshotId", offered_at as "offeredAt", expires_at as "expiresAt", accepted_at as "acceptedAt", score_breakdown as "metrics"
      `;
      return rows[0];
    },
    expireOffer: async (assignmentId: string) => {
      const rows = await this.sql<Assignment[]>`
        UPDATE assignment SET status = 'expired' WHERE id = ${assignmentId}
        RETURNING id, job_id as "jobId", technician_id as "technicianId", status, snapshot_id as "snapshotId", offered_at as "offeredAt", expires_at as "expiresAt", accepted_at as "acceptedAt", score_breakdown as "metrics"
      `;
      return rows[0];
    },
  };

  // Status Events Implementation
  statusEvents = {
    getByJobId: async (jobId: string) => {
      return await this.sql<StatusEvent[]>`SELECT id, job_id as "jobId", from_status as "fromStatus", to_status as "toStatus", actor_id as "actorId", actor_role as "actorRole", reason, created_at as "createdAt" FROM status_event WHERE job_id = ${jobId}`;
    },
    listAll: async () => {
      return await this.sql<StatusEvent[]>`SELECT id, job_id as "jobId", from_status as "fromStatus", to_status as "toStatus", actor_id as "actorId", actor_role as "actorRole", reason, created_at as "createdAt" FROM status_event ORDER BY created_at ASC`;
    },
  };

  // Travel Matrix Implementation
  travelMatrix = {
    getTravelMinutes: async (fromCluster: string, toCluster: string, isPeak: boolean = false) => {
      const rows = await this.sql<{ minutes: number; peak_minutes: number }[]>`
        SELECT minutes, peak_minutes FROM travel_matrix WHERE from_cluster = ${fromCluster} AND to_cluster = ${toCluster}
      `;
      if (!rows[0]) {
        throw new Error(`TRAVEL_MATRIX_MISSING:${fromCluster}->${toCluster}`);
      }
      return isPeak ? rows[0].peak_minutes : rows[0].minutes;
    },
    listAll: async () => {
      return await this.sql<TravelMatrix[]>`
        SELECT id, from_cluster as "fromCluster", to_cluster as "toCluster", minutes, peak_minutes as "peakMinutes", source, created_at as "createdAt"
        FROM travel_matrix
      `;
    },
    setMatrix: async (entries: Array<{ fromCluster: string; toCluster: string; minutes: number; peakMinutes: number }>) => {
      for (const e of entries) {
        await this.sql`
          INSERT INTO travel_matrix (from_cluster, to_cluster, minutes, peak_minutes, source)
          VALUES (${e.fromCluster}, ${e.toCluster}, ${e.minutes}, ${e.peakMinutes}, 'seeded')
          ON CONFLICT (from_cluster, to_cluster) DO UPDATE SET minutes = ${e.minutes}, peak_minutes = ${e.peakMinutes}
        `;
      }
    },
  };

  // Snapshots & Decision Logs Implementation
  boardSnapshots = {
    getLatestVersion: async () => {
      const rows = await this.sql<{ max_ver: number }[]>`SELECT COALESCE(MAX(version), 0) as max_ver FROM board_snapshot`;
      return rows[0]?.max_ver || 0;
    },
    getLatest: async () => {
      const rows = await this.sql<BoardSnapshot[]>`
        SELECT id, version, source_snapshot_id as "sourceSnapshotId", trigger_event_id as "triggerEventId",
               snapshot_data as "snapshotData", metrics, created_by as "createdBy", committed_at as "committedAt",
               created_at as "createdAt"
        FROM board_snapshot ORDER BY version DESC LIMIT 1
      `;
      return rows[0] || null;
    },
    getSnapshot: async (version: number) => {
      const rows = await this.sql<BoardSnapshot[]>`
        SELECT id, version, source_snapshot_id as "sourceSnapshotId", trigger_event_id as "triggerEventId",
               snapshot_data as "snapshotData", metrics, created_by as "createdBy", committed_at as "committedAt",
               created_at as "createdAt"
        FROM board_snapshot WHERE version = ${version}
      `;
      return rows[0] || null;
    },
    createSnapshot: async (
      data: Record<string, unknown>,
      extra?: { sourceSnapshotId?: string; triggerEventId?: string },
    ) => {
      const nextVer = (await this.boardSnapshots.getLatestVersion()) + 1;
      const rows = await this.sql<BoardSnapshot[]>`
        INSERT INTO board_snapshot (version, snapshot_data, source_snapshot_id, trigger_event_id)
        VALUES (${nextVer}, ${JSON.stringify(data)}, ${extra?.sourceSnapshotId || null}, ${extra?.triggerEventId || null})
        RETURNING id, version, source_snapshot_id as "sourceSnapshotId", trigger_event_id as "triggerEventId",
                  snapshot_data as "snapshotData", metrics, created_by as "createdBy", committed_at as "committedAt",
                  created_at as "createdAt"
      `;
      return rows[0];
    },
  };

  // decision_log is append-only. Every column the schema defines is written and
  // read back: event_id in particular, or listByEvent can never match anything.
  decisionLogs = {
    getById: async (id: string) => {
      const rows = await this.sql<DecisionLog[]>`SELECT id, event_id as "eventId", event_type as "eventType", playbook, sequence, stage, tool_calls as "toolCalls", summary, reason_codes as "reasonCodes", duration_ms as "durationMs", result, approval_id as "approvalId", created_at as "createdAt" FROM decision_log WHERE id = ${id}`;
      return rows[0] || null;
    },
    listByEvent: async (eventId: string) => {
      return await this.sql<DecisionLog[]>`
        SELECT id, event_id as "eventId", event_type as "eventType", playbook, sequence, stage, tool_calls as "toolCalls", summary, reason_codes as "reasonCodes", duration_ms as "durationMs", result, approval_id as "approvalId", created_at as "createdAt"
        FROM decision_log
        WHERE event_id = ${eventId}
        ORDER BY sequence ASC NULLS LAST, created_at ASC
      `;
    },
    create: async (log: Omit<DecisionLog, 'id' | 'createdAt'>) => {
      const rows = await this.sql<DecisionLog[]>`
        INSERT INTO decision_log (event_id, event_type, playbook, sequence, stage, tool_calls, summary, reason_codes, duration_ms, result, approval_id)
        VALUES (
          ${log.eventId ?? null}, ${log.eventType}, ${log.playbook}, ${log.sequence ?? null},
          ${log.stage ?? null}, ${JSON.stringify(log.toolCalls)}, ${log.summary},
          ${JSON.stringify(log.reasonCodes ?? [])}, ${log.durationMs ?? null},
          ${log.result ?? null}, ${log.approvalId ?? null}
        )
        RETURNING id, event_id as "eventId", event_type as "eventType", playbook, sequence, stage, tool_calls as "toolCalls", summary, reason_codes as "reasonCodes", duration_ms as "durationMs", result, approval_id as "approvalId", created_at as "createdAt"
      `;
      return rows[0];
    },
  };

  // Approvals Implementation
  approvals = {
    getById: async (id: string) => {
      const rows = await this.sql<Approval[]>`SELECT id, proposal_id as "proposalId", thread_id as "threadId", job_id as "jobId", source_snapshot_id as "sourceSnapshotId", trigger_reason as "triggerReason", recommendation, who_would_be_late as "whoWouldBeLate", policy_reasons as "policyReasons", approved_plan_id as "approvedPlanId", status, actioned_by as "actionedBy", actioned_reason as "actionedReason", created_at as "createdAt", actioned_at as "actionedAt" FROM approval WHERE id = ${id}`;
      return rows[0] || null;
    },
    getByProposal: async (proposalId: string) => {
      const rows = await this.sql<Approval[]>`
        SELECT id, proposal_id as "proposalId", thread_id as "threadId", job_id as "jobId", source_snapshot_id as "sourceSnapshotId", trigger_reason as "triggerReason", recommendation, who_would_be_late as "whoWouldBeLate", policy_reasons as "policyReasons", approved_plan_id as "approvedPlanId", status, actioned_by as "actionedBy", actioned_reason as "actionedReason", created_at as "createdAt", actioned_at as "actionedAt"
        FROM approval WHERE proposal_id = ${proposalId}
        ORDER BY created_at DESC LIMIT 1
      `;
      return rows[0] || null;
    },
    listPending: async () => {
      return await this.sql<Approval[]>`SELECT id, proposal_id as "proposalId", thread_id as "threadId", job_id as "jobId", source_snapshot_id as "sourceSnapshotId", trigger_reason as "triggerReason", recommendation, who_would_be_late as "whoWouldBeLate", policy_reasons as "policyReasons", approved_plan_id as "approvedPlanId", status, actioned_by as "actionedBy", actioned_reason as "actionedReason", created_at as "createdAt", actioned_at as "actionedAt" FROM approval WHERE status = 'pending'`;
    },
    create: async (approval: Omit<Approval, 'id' | 'createdAt'>) => {
      const rows = await this.sql<Approval[]>`
        INSERT INTO approval (proposal_id, thread_id, job_id, source_snapshot_id, trigger_reason, recommendation, who_would_be_late, policy_reasons, approved_plan_id)
        VALUES (${approval.proposalId || null}, ${approval.threadId}, ${approval.jobId || null}, ${approval.sourceSnapshotId || null}, ${approval.triggerReason}, ${JSON.stringify(approval.recommendation)}, ${approval.whoWouldBeLate ? JSON.stringify(approval.whoWouldBeLate) : null}, ${JSON.stringify(approval.policyReasons || [])}, ${approval.approvedPlanId || null})
        RETURNING id, proposal_id as "proposalId", thread_id as "threadId", job_id as "jobId", source_snapshot_id as "sourceSnapshotId", trigger_reason as "triggerReason", recommendation, who_would_be_late as "whoWouldBeLate", policy_reasons as "policyReasons", approved_plan_id as "approvedPlanId", status, actioned_by as "actionedBy", actioned_reason as "actionedReason", created_at as "createdAt", actioned_at as "actionedAt"
      `;
      return rows[0];
    },
    action: async (id: string, status: 'approved' | 'rejected', actionedBy: string, reason?: string) => {
      const rows = await this.sql<Approval[]>`
        UPDATE approval SET status = ${status}, actioned_by = ${actionedBy}, actioned_reason = ${reason || null}, actioned_at = NOW()
        WHERE id = ${id}
        RETURNING id, proposal_id as "proposalId", thread_id as "threadId", job_id as "jobId", source_snapshot_id as "sourceSnapshotId", trigger_reason as "triggerReason", recommendation, who_would_be_late as "whoWouldBeLate", policy_reasons as "policyReasons", approved_plan_id as "approvedPlanId", status, actioned_by as "actionedBy", actioned_reason as "actionedReason", created_at as "createdAt", actioned_at as "actionedAt"
      `;
      return rows[0];
    },
  };

  events = {
    getById: async (id: string) => {
      const rows = await this.sql<OperationalEvent[]>`
        SELECT id, type, raw_text as "rawText", normalized_payload as "normalizedPayload",
               source_snapshot_id as "sourceSnapshotId", affected_ids as "affectedIds",
               validation_issues as "validationIssues", status, received_at as "receivedAt"
        FROM operational_event WHERE id = ${id}
      `;
      return rows[0] || null;
    },
    create: async (event: Omit<OperationalEvent, 'id' | 'receivedAt'>) => {
      const rows = await this.sql<OperationalEvent[]>`
        INSERT INTO operational_event (type, raw_text, normalized_payload, source_snapshot_id, affected_ids, validation_issues, status)
        VALUES (${event.type}, ${event.rawText}, ${JSON.stringify(event.normalizedPayload)}, ${event.sourceSnapshotId || null}, ${JSON.stringify(event.affectedIds)}, ${JSON.stringify(event.validationIssues)}, ${event.status})
        RETURNING id, type, raw_text as "rawText", normalized_payload as "normalizedPayload",
                  source_snapshot_id as "sourceSnapshotId", affected_ids as "affectedIds",
                  validation_issues as "validationIssues", status, received_at as "receivedAt"
      `;
      return rows[0];
    },
    updateStatus: async (id: string, status: OperationalEventStatus) => {
      const rows = await this.sql<OperationalEvent[]>`
        UPDATE operational_event SET status = ${status} WHERE id = ${id}
        RETURNING id, type, raw_text as "rawText", normalized_payload as "normalizedPayload",
                  source_snapshot_id as "sourceSnapshotId", affected_ids as "affectedIds",
                  validation_issues as "validationIssues", status, received_at as "receivedAt"
      `;
      return rows[0];
    },
  };

  proposals = {
    getById: async (id: string) => {
      const rows = await this.sql<Proposal[]>`
        SELECT id, event_id as "eventId", source_snapshot_id as "sourceSnapshotId",
               recommended_plan_id as "recommendedPlanId", risk, autonomy_mode as "autonomyMode",
               status, created_at as "createdAt"
        FROM proposal WHERE id = ${id}
      `;
      return rows[0] || null;
    },
    getByEventId: async (eventId: string) => {
      const rows = await this.sql<Proposal[]>`
        SELECT id, event_id as "eventId", source_snapshot_id as "sourceSnapshotId",
               recommended_plan_id as "recommendedPlanId", risk, autonomy_mode as "autonomyMode",
               status, created_at as "createdAt"
        FROM proposal WHERE event_id = ${eventId}
        ORDER BY created_at DESC LIMIT 1
      `;
      return rows[0] || null;
    },
    create: async (proposal: Omit<Proposal, 'id' | 'createdAt'>) => {
      const rows = await this.sql<Proposal[]>`
        INSERT INTO proposal (event_id, source_snapshot_id, recommended_plan_id, risk, autonomy_mode, status)
        VALUES (${proposal.eventId}, ${proposal.sourceSnapshotId}, ${proposal.recommendedPlanId || null}, ${proposal.risk}, ${proposal.autonomyMode}, ${proposal.status})
        RETURNING id, event_id as "eventId", source_snapshot_id as "sourceSnapshotId",
                  recommended_plan_id as "recommendedPlanId", risk, autonomy_mode as "autonomyMode",
                  status, created_at as "createdAt"
      `;
      return rows[0];
    },
    updateStatus: async (id: string, status: ProposalStatus, recommendedPlanId?: string) => {
      const rows = await this.sql<Proposal[]>`
        UPDATE proposal
        SET status = ${status},
            recommended_plan_id = COALESCE(${recommendedPlanId || null}, recommended_plan_id)
        WHERE id = ${id}
        RETURNING id, event_id as "eventId", source_snapshot_id as "sourceSnapshotId",
                  recommended_plan_id as "recommendedPlanId", risk, autonomy_mode as "autonomyMode",
                  status, created_at as "createdAt"
      `;
      return rows[0];
    },
  };

  candidatePlans = {
    getById: async (id: string) => {
      const rows = await this.sql<CandidatePlan[]>`
        SELECT id, proposal_id as "proposalId", source_snapshot_id as "sourceSnapshotId", profile,
               assignments, change_set as "changeSet", metrics, validations,
               solver_trace as "solverTrace", timed_out as "timedOut", duration_ms as "durationMs",
               status, created_at as "createdAt"
        FROM candidate_plan WHERE id = ${id}
      `;
      return rows[0] || null;
    },
    listByProposal: async (proposalId: string) => {
      return await this.sql<CandidatePlan[]>`
        SELECT id, proposal_id as "proposalId", source_snapshot_id as "sourceSnapshotId", profile,
               assignments, change_set as "changeSet", metrics, validations,
               solver_trace as "solverTrace", timed_out as "timedOut", duration_ms as "durationMs",
               status, created_at as "createdAt"
        FROM candidate_plan WHERE proposal_id = ${proposalId}
      `;
    },
    create: async (plan: Omit<CandidatePlan, 'id' | 'createdAt'>) => {
      const rows = await this.sql<CandidatePlan[]>`
        INSERT INTO candidate_plan (
          proposal_id, source_snapshot_id, profile, assignments, change_set, metrics,
          validations, solver_trace, timed_out, duration_ms, status
        )
        VALUES (
          ${plan.proposalId}, ${plan.sourceSnapshotId}, ${plan.profile},
          ${JSON.stringify(plan.assignments)}, ${JSON.stringify(plan.changeSet)},
          ${JSON.stringify(plan.metrics)}, ${JSON.stringify(plan.validations)},
          ${JSON.stringify(plan.solverTrace)}, ${plan.timedOut}, ${plan.durationMs || null}, ${plan.status}
        )
        RETURNING id, proposal_id as "proposalId", source_snapshot_id as "sourceSnapshotId", profile,
                  assignments, change_set as "changeSet", metrics, validations,
                  solver_trace as "solverTrace", timed_out as "timedOut", duration_ms as "durationMs",
                  status, created_at as "createdAt"
      `;
      return rows[0];
    },
  };
}
