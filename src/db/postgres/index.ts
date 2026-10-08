// Dispatch Coordinator v1.1
// Postgres client. Local Compose or the Lightsail volume — not RDS.
//
// It must return exactly what the in-memory adapter returns, because every
// caller was written and tested against that one. Three things make it so:
//   - Times come back as Singapore wall-clock ISO strings
//     ("2026-10-06T09:00:00+08:00"), the form the seed, the solver and the
//     desk use. postgres.js would otherwise hand back Date objects, and the
//     commit path compares slot times as strings.
//   - DATE columns come back as "YYYY-MM-DD" strings, which Stage A and the
//     validator compare lexically.
//   - NULL columns are left off the row, as the memory adapter leaves an
//     optional field undefined.
// src/db/postgres/postgres.contract.test.ts holds the two adapters to that.

import { DEFAULT_SETTINGS, type CompanySettings } from '../../shared/contracts/settings';
import postgres from 'postgres';
import { EASTWIND, type Scenario } from '../../shared/fixtures/eastwind';
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
import { StaleSnapshotError, type IDatabase } from '../interface';
import { migrate } from './migrate';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://dispatch:dispatch@localhost:5432/dispatch';

const SG_OFFSET_MS = 8 * 60 * 60 * 1000;

/** An instant as Singapore wall-clock ISO, e.g. 2026-10-06T09:00:00+08:00. */
export function toSgIso(ms: number): string {
  return `${new Date(ms + SG_OFFSET_MS).toISOString().slice(0, 19)}+08:00`;
}

/** Postgres text output for timestamptz ("2026-10-06 01:00:00+00") to Singapore ISO. */
function parseTimestamp(text: string): string {
  const iso = text.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? text : toSgIso(ms);
}

type Sql = postgres.Sql;
type Row = Record<string, unknown>;

function withoutNulls<T>(row: Row): T {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) if (v !== null) out[k] = v;
  return out as T;
}

export function connect(url = DATABASE_URL, schema?: string): Sql {
  return postgres(url, {
    // A workspace lives in its own schema; unqualified table names resolve there.
    ...(schema ? { connection: { search_path: schema } } : {}),
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    types: {
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
      timestamptz: {
        to: 1184,
        from: [1184, 1114],
        serialize: (x: string | Date) => (x instanceof Date ? x.toISOString() : x),
        parse: parseTimestamp,
      },
      numeric: { to: 1700, from: [1700], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
    },
  });
}

const USER_COLS = `id, demo_login as "demoLogin", cognito_sub as "cognitoSub", role, name, email, phone, created_at as "createdAt"`;
const TECH_COLS = `id, user_id as "userId", name, tier, home_region as "homeRegion", current_cluster as "currentCluster", max_minutes_day as "maxMinutesDay", accepts_ot as "acceptsOt", parts, tools, is_active as "isActive", created_at as "createdAt"`;
const CERT_COLS = `id, technician_id as "technicianId", cert_type as "certType", brand, issued_at as "issuedAt", expires_at as "expiresAt", is_legal_gate as "isLegalGate", created_at as "createdAt"`;
const SHIFT_COLS = `id, technician_id as "technicianId", shift_date as "shiftDate", status, clock_in_at as "clockInAt", clock_out_at as "clockOutAt", created_at as "createdAt"`;
const CUSTOMER_COLS = `id, name, phone, email, company_name as "companyName", created_at as "createdAt"`;
const SITE_COLS = `id, customer_id as "customerId", postal_code as "postalCode", region, estate_cluster as "estateCluster", address_line1 as "addressLine1", unit_no as "unitNo", last_technician_id as "lastTechnicianId", preferred_technician_id as "preferredTechnicianId", access_flags as "accessFlags", created_at as "createdAt"`;
const JOB_TYPE_COLS = `id, name, min_tier as "minTier", difficulty, default_minutes as "defaultMinutes", sla_hours as "slaHours", brand_sensitive as "brandSensitive", created_at as "createdAt"`;
const JOB_COLS = `id, customer_id as "customerId", site_id as "siteId", job_type_id as "jobTypeId", status, priority, window_type as "windowType", lock_state as "lockState", scheduled_date as "scheduledDate", window_start as "windowStart", window_end as "windowEnd", duration_minutes as "durationMinutes", parts_required as "partsRequired", tools_required as "toolsRequired", note_raw as "noteRaw", intake_parsed as "intakeParsed", required_crew_size as "requiredCrewSize", board_version_at_rank as "boardVersionAtRank", confidence_score as "confidenceScore", created_at as "createdAt", updated_at as "updatedAt"`;
const REQ_COLS = `id, job_id as "jobId", min_tier as "minTier", required_certs as "requiredCerts", brand_required as "brandRequired", required_crew_size as "requiredCrewSize", created_at as "createdAt"`;
const ASSIGNMENT_COLS = `id, job_id as "jobId", technician_id as "technicianId", status, snapshot_id as "snapshotId", window_start as "windowStart", window_end as "windowEnd", travel_before_minutes as "travelBeforeMinutes", offered_at as "offeredAt", expires_at as "expiresAt", accepted_at as "acceptedAt", score_breakdown as "metrics", decision_log_id as "decisionLogId"`;
const STATUS_EVENT_COLS = `id, job_id as "jobId", from_status as "fromStatus", to_status as "toStatus", actor_id as "actorId", actor_role as "actorRole", reason, created_at as "createdAt"`;
const TRAVEL_COLS = `id, from_cluster as "fromCluster", to_cluster as "toCluster", minutes, peak_minutes as "peakMinutes", source, created_at as "createdAt"`;
const SNAPSHOT_COLS = `id, version, source_snapshot_id as "sourceSnapshotId", trigger_event_id as "triggerEventId", snapshot_data as "snapshotData", metrics, created_by as "createdBy", committed_at as "committedAt", created_at as "createdAt"`;
const LOG_COLS = `id, event_id as "eventId", event_type as "eventType", playbook, sequence, stage, tool_calls as "toolCalls", summary, reason_codes as "reasonCodes", duration_ms as "durationMs", result, approval_id as "approvalId", created_at as "createdAt"`;
const APPROVAL_COLS = `id, proposal_id as "proposalId", thread_id as "threadId", job_id as "jobId", source_snapshot_id as "sourceSnapshotId", trigger_reason as "triggerReason", recommendation, who_would_be_late as "whoWouldBeLate", policy_reasons as "policyReasons", approved_plan_id as "approvedPlanId", status, actioned_by as "actionedBy", actioned_reason as "actionedReason", created_at as "createdAt", actioned_at as "actionedAt"`;
const EVENT_COLS = `id, type, raw_text as "rawText", normalized_payload as "normalizedPayload", source_snapshot_id as "sourceSnapshotId", affected_ids as "affectedIds", validation_issues as "validationIssues", status, received_at as "receivedAt"`;
const PROPOSAL_COLS = `id, event_id as "eventId", source_snapshot_id as "sourceSnapshotId", recommended_plan_id as "recommendedPlanId", risk, autonomy_mode as "autonomyMode", status, created_at as "createdAt"`;
const PLAN_COLS = `id, proposal_id as "proposalId", source_snapshot_id as "sourceSnapshotId", profile, assignments, change_set as "changeSet", metrics, validations, solver_trace as "solverTrace", timed_out as "timedOut", duration_ms as "durationMs", status, created_at as "createdAt"`;

// Everything a reset clears. Not schema_migration, and not risk_policy, which
// the baseline migration seeds.
const DATA_TABLES = [
  'candidate_plan', 'approval', 'proposal', 'decision_log', 'operational_event', 'board_snapshot',
  'status_event', 'assignment', 'job_requirement', 'job', 'site_memory', 'recurrence', 'site', 'customer',
  'shift', 'technician_cert', 'technician', 'app_user', 'travel_matrix', 'intake_message', 'dispatch_policy',
  'job_type_cert', 'job_type', 'company_setting',
];

// Serialises "seed if the database is empty" across processes.
const SEED_LOCK = 7_204_152;

export interface PostgresOptions {
  url?: string;
  /** What a reset (or a first start on an empty database) loads. Defaults to Eastwind. */
  scenario?: () => Scenario;
  /** Postgres schema for this workspace (created on first use). Default: public. */
  schema?: string;
  /** Internal: an open transaction to run against instead of a pool. */
  sql?: Sql;
}

export class PostgresDatabase implements IDatabase {
  private readonly sql: Sql;
  private readonly scenario: () => Scenario;
  private readonly schema: string | undefined;
  private readonly inTransaction: boolean;
  private readyPromise: Promise<void> | null;

  constructor(options: PostgresOptions | string = {}) {
    const opts = typeof options === 'string' ? { url: options } : options;
    if (opts.schema && !/^[a-z_][a-z0-9_]*$/.test(opts.schema)) throw new Error(`Bad schema name: ${opts.schema}`);
    this.schema = opts.schema;
    this.sql = opts.sql ?? connect(opts.url, opts.schema);
    this.scenario = opts.scenario ?? (() => EASTWIND);
    this.inTransaction = Boolean(opts.sql);
    this.readyPromise = this.inTransaction ? Promise.resolve() : null;
  }

  /** Migrate, then seed if the board is empty. Every query waits for this once. */
  public ready(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        if (this.schema) await this.sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);
        await migrate(this.sql);
        await this.sql.begin(async (tx) => {
          await tx`SELECT pg_advisory_xact_lock(${SEED_LOCK})`;
          const [row] = await tx<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM board_snapshot`;
          if (!row?.n) {
            // No board means nothing worth keeping: start from a clean seed.
            await tx.unsafe(`TRUNCATE TABLE ${DATA_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
            await this.load(tx as unknown as Sql, this.scenario());
          } else {
            // A board seeded before settings existed (0003) gets its scenario's
            // company row; one already stored is never overwritten.
            const company = this.scenario().company;
            if (company) {
              await tx`INSERT INTO company_setting (name, day_start, day_end, default_profile)
                VALUES (${company.name}, ${company.dayStart}, ${company.dayEnd}, ${company.defaultProfile})
                ON CONFLICT (id) DO NOTHING`;
            }
          }
        });
      })().catch((e) => {
        this.readyPromise = null;
        throw e;
      });
    }
    return this.readyPromise;
  }

  public async close(): Promise<void> {
    if (!this.inTransaction) await this.sql.end({ timeout: 5 });
  }

  private async q<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> {
    await this.ready();
    const rows = await this.sql(strings, ...(values as never[]));
    return Array.from(rows as unknown as Row[], (r) => withoutNulls<T>(r));
  }

  private async one<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T | null> {
    return (await this.q<T>(strings, ...values))[0] ?? null;
  }

  private cols(list: string) {
    return this.sql.unsafe(list);
  }

  private json(value: unknown) {
    return this.sql.json(value as postgres.JSONValue);
  }

  public async reset(): Promise<void> {
    await this.ready();
    await this.inTx(async (tx) => {
      await tx.unsafe(`TRUNCATE TABLE ${DATA_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
      await this.load(tx, this.scenario());
    });
  }

  public async seed(): Promise<void> {
    await this.reset();
  }

  public async transaction<T>(fn: (db: IDatabase) => Promise<T>): Promise<T> {
    if (this.inTransaction) return fn(this);
    await this.ready();
    return (await this.sql.begin((tx) =>
      fn(new PostgresDatabase({ sql: tx as unknown as Sql, scenario: this.scenario, schema: this.schema })),
    )) as T;
  }

  private async inTx(fn: (tx: Sql) => Promise<void>): Promise<void> {
    if (this.inTransaction) return fn(this.sql);
    await this.sql.begin((tx) => fn(tx as unknown as Sql));
  }

  /** Insert a whole scenario with its own ids, in foreign-key order. */
  private async load(tx: Sql, data: Scenario): Promise<void> {
    for (const u of data.users) {
      await tx`INSERT INTO app_user (id, demo_login, cognito_sub, role, name, email, phone, created_at)
        VALUES (${u.id}, ${u.demoLogin ?? null}, ${u.cognitoSub ?? null}, ${u.role}, ${u.name}, ${u.email ?? null}, ${u.phone ?? null}, ${u.createdAt})`;
    }
    for (const t of data.technicians) {
      await tx`INSERT INTO technician (id, user_id, name, tier, home_region, current_cluster, max_minutes_day, accepts_ot, parts, tools, is_active, created_at)
        VALUES (${t.id}, ${t.userId ?? null}, ${t.name}, ${t.tier}, ${t.homeRegion}, ${t.currentCluster ?? null}, ${t.maxMinutesDay}, ${t.acceptsOt}, ${t.parts ?? []}::text[], ${t.tools ?? []}::text[], ${t.isActive}, ${t.createdAt})`;
    }
    for (const c of data.certs) {
      await tx`INSERT INTO technician_cert (id, technician_id, cert_type, brand, issued_at, expires_at, is_legal_gate, created_at)
        VALUES (${c.id}, ${c.technicianId}, ${c.certType}, ${c.brand ?? null}, ${c.issuedAt}::date, ${c.expiresAt ?? null}::date, ${c.isLegalGate}, ${c.createdAt})`;
    }
    for (const s of data.shifts) {
      await tx`INSERT INTO shift (id, technician_id, shift_date, status, clock_in_at, clock_out_at, created_at)
        VALUES (${s.id}, ${s.technicianId}, ${s.shiftDate}::date, ${s.status}, ${s.clockInAt ?? null}, ${s.clockOutAt ?? null}, ${s.createdAt})`;
    }
    for (const c of data.customers) {
      await tx`INSERT INTO customer (id, name, phone, email, company_name, created_at)
        VALUES (${c.id}, ${c.name}, ${c.phone}, ${c.email ?? null}, ${c.companyName ?? null}, ${c.createdAt})`;
    }
    for (const s of data.sites) {
      await tx`INSERT INTO site (id, customer_id, postal_code, region, estate_cluster, address_line1, unit_no, last_technician_id, preferred_technician_id, access_flags, created_at)
        VALUES (${s.id}, ${s.customerId}, ${s.postalCode}, ${s.region}, ${s.estateCluster}, ${s.addressLine1}, ${s.unitNo}, ${s.lastTechnicianId ?? null}, ${s.preferredTechnicianId ?? null}, ${s.accessFlags ?? []}::text[], ${s.createdAt})`;
    }
    for (const jt of data.jobTypes) {
      await tx`INSERT INTO job_type (id, name, min_tier, difficulty, default_minutes, sla_hours, brand_sensitive, created_at)
        VALUES (${jt.id}, ${jt.name}, ${jt.minTier}, ${jt.difficulty}, ${jt.defaultMinutes}, ${jt.slaHours ?? null}, ${jt.brandSensitive}, ${jt.createdAt})`;
    }
    if (data.company) {
      await tx`INSERT INTO company_setting (name, day_start, day_end, default_profile)
        VALUES (${data.company.name}, ${data.company.dayStart}, ${data.company.dayEnd}, ${data.company.defaultProfile})`;
    }
    for (const c of data.jobTypeCerts) {
      await tx`INSERT INTO job_type_cert (id, job_type_id, cert_type, brand_required)
        VALUES (${c.id}, ${c.jobTypeId}, ${c.certType}, ${c.brandRequired})`;
    }
    for (const j of data.jobs) {
      await tx`INSERT INTO job (id, customer_id, site_id, job_type_id, status, priority, window_type, lock_state, scheduled_date, window_start, window_end, duration_minutes, parts_required, tools_required, note_raw, intake_parsed, required_crew_size, board_version_at_rank, confidence_score, created_at, updated_at)
        VALUES (${j.id}, ${j.customerId}, ${j.siteId}, ${j.jobTypeId}, ${j.status}, ${j.priority}, ${j.windowType}, ${j.lockState ?? 'none'}, ${j.scheduledDate}::date, ${j.windowStart ?? null}, ${j.windowEnd ?? null}, ${j.durationMinutes ?? 60}, ${j.partsRequired ?? []}::text[], ${j.toolsRequired ?? []}::text[], ${j.noteRaw}, ${j.intakeParsed ? tx.json(j.intakeParsed as postgres.JSONValue) : null}, ${j.requiredCrewSize}, ${j.boardVersionAtRank}, ${j.confidenceScore}, ${j.createdAt}, ${j.updatedAt})`;
    }
    for (const r of data.jobRequirements) {
      await tx`INSERT INTO job_requirement (id, job_id, min_tier, required_certs, brand_required, required_crew_size, created_at)
        VALUES (${r.id}, ${r.jobId}, ${r.minTier}, ${r.requiredCerts}::text[], ${r.brandRequired ?? null}, ${r.requiredCrewSize}, ${r.createdAt})`;
    }
    for (const a of data.assignments) {
      await tx`INSERT INTO assignment (id, job_id, technician_id, status, snapshot_id, window_start, window_end, travel_before_minutes, offered_at, expires_at, accepted_at, score_breakdown, decision_log_id)
        VALUES (${a.id}, ${a.jobId}, ${a.technicianId}, ${a.status}, ${a.snapshotId}, ${a.windowStart ?? null}, ${a.windowEnd ?? null}, ${a.travelBeforeMinutes ?? null}, ${a.offeredAt}, ${a.expiresAt ?? null}, ${a.acceptedAt ?? null}, ${tx.json(a.metrics as unknown as postgres.JSONValue)}, ${a.decisionLogId ?? null})`;
    }
    for (const t of data.travel) {
      await tx`INSERT INTO travel_matrix (id, from_cluster, to_cluster, minutes, peak_minutes, source, created_at)
        VALUES (${t.id}, ${t.fromCluster}, ${t.toCluster}, ${t.minutes}, ${t.peakMinutes}, ${t.source}, ${t.createdAt})`;
    }
    const s = data.snapshot;
    await tx`INSERT INTO board_snapshot (id, version, source_snapshot_id, trigger_event_id, snapshot_data, metrics, created_by, committed_at, created_at)
      VALUES (${s.id}, ${s.version}, ${s.sourceSnapshotId ?? null}, ${s.triggerEventId ?? null}, ${tx.json(s.snapshotData as postgres.JSONValue)}, ${tx.json((s.metrics ?? {}) as postgres.JSONValue)}, ${s.createdBy ?? null}, ${s.committedAt ?? null}, ${s.createdAt})`;
  }

  users = {
    getById: (id: string) => this.one<AppUser>`SELECT ${this.cols(USER_COLS)} FROM app_user WHERE id = ${id}`,
    getByCognitoSub: (sub: string) =>
      this.one<AppUser>`SELECT ${this.cols(USER_COLS)} FROM app_user WHERE cognito_sub = ${sub}`,
    getByDemoLogin: (login: string) =>
      this.one<AppUser>`SELECT ${this.cols(USER_COLS)} FROM app_user WHERE demo_login = ${login}`,
    create: async (user: Omit<AppUser, 'id' | 'createdAt'>) =>
      (await this.one<AppUser>`
        INSERT INTO app_user (demo_login, cognito_sub, role, name, email, phone)
        VALUES (${user.demoLogin ?? null}, ${user.cognitoSub ?? null}, ${user.role}, ${user.name}, ${user.email ?? null}, ${user.phone ?? null})
        RETURNING ${this.cols(USER_COLS)}`)!,
  };

  technicians = {
    getById: (id: string) => this.one<Technician>`SELECT ${this.cols(TECH_COLS)} FROM technician WHERE id = ${id}`,
    listAll: () => this.q<Technician>`SELECT ${this.cols(TECH_COLS)} FROM technician ORDER BY id COLLATE "C"`,
    listActive: () => this.q<Technician>`SELECT ${this.cols(TECH_COLS)} FROM technician WHERE is_active ORDER BY id COLLATE "C"`,
    getCerts: (technicianId: string) =>
      this.q<TechnicianCert>`SELECT ${this.cols(CERT_COLS)} FROM technician_cert WHERE technician_id = ${technicianId} ORDER BY id COLLATE "C"`,
    certValidOn: async (technicianId: string, certType: string, dateStr: string) =>
      Boolean((await this.one<{ valid: boolean }>`SELECT cert_valid_on(${technicianId}, ${certType}, ${dateStr}::date) AS valid`)?.valid),
    addCert: async (cert: Omit<TechnicianCert, 'id' | 'createdAt'>) =>
      (await this.one<TechnicianCert>`
        INSERT INTO technician_cert (technician_id, cert_type, brand, issued_at, expires_at, is_legal_gate)
        VALUES (${cert.technicianId}, ${cert.certType}, ${cert.brand ?? null}, ${cert.issuedAt}::date, ${cert.expiresAt ?? null}::date, ${cert.isLegalGate})
        RETURNING ${this.cols(CERT_COLS)}`)!,
    create: async (tech: Omit<Technician, 'id' | 'createdAt'>) =>
      (await this.one<Technician>`
        INSERT INTO technician (user_id, name, tier, home_region, current_cluster, max_minutes_day, accepts_ot, parts, tools, is_active)
        VALUES (${tech.userId ?? null}, ${tech.name}, ${tech.tier}, ${tech.homeRegion}, ${tech.currentCluster ?? null}, ${tech.maxMinutesDay}, ${tech.acceptsOt}, ${tech.parts ?? []}::text[], ${tech.tools ?? []}::text[], ${tech.isActive})
        RETURNING ${this.cols(TECH_COLS)}`)!,
    update: async (id: string, patch: Partial<Omit<Technician, 'id' | 'createdAt'>>) => {
      const row = await this.one<Technician>`
        UPDATE technician SET
          name = COALESCE(${patch.name ?? null}, name),
          tier = COALESCE(${patch.tier ?? null}::int, tier),
          home_region = COALESCE(${patch.homeRegion ?? null}, home_region),
          current_cluster = COALESCE(${patch.currentCluster ?? null}, current_cluster),
          max_minutes_day = COALESCE(${patch.maxMinutesDay ?? null}::int, max_minutes_day),
          accepts_ot = COALESCE(${patch.acceptsOt ?? null}::boolean, accepts_ot),
          parts = COALESCE(${patch.parts ?? null}::text[], parts),
          tools = COALESCE(${patch.tools ?? null}::text[], tools),
          is_active = COALESCE(${patch.isActive ?? null}::boolean, is_active)
        WHERE id = ${id}
        RETURNING ${this.cols(TECH_COLS)}`;
      if (!row) throw new Error(`Technician ${id} not found`);
      return row;
    },
    setCerts: async (technicianId: string, certs: Array<Omit<TechnicianCert, 'id' | 'createdAt' | 'technicianId'>>) => {
      await this.q`DELETE FROM technician_cert WHERE technician_id = ${technicianId}`;
      for (const c of certs) {
        await this.q`
          INSERT INTO technician_cert (technician_id, cert_type, brand, issued_at, expires_at, is_legal_gate)
          VALUES (${technicianId}, ${c.certType}, ${c.brand ?? null}, ${c.issuedAt}::date, ${c.expiresAt ?? null}::date, ${c.isLegalGate})`;
      }
      return this.technicians.getCerts(technicianId);
    },
  };

  shifts = {
    getByTechAndDate: (technicianId: string, dateStr: string) =>
      this.one<Shift>`SELECT ${this.cols(SHIFT_COLS)} FROM shift WHERE technician_id = ${technicianId} AND shift_date = ${dateStr}::date`,
    clockIn: async (technicianId: string, dateStr: string) =>
      (await this.one<Shift>`
        INSERT INTO shift (technician_id, shift_date, status, clock_in_at)
        VALUES (${technicianId}, ${dateStr}::date, 'clocked_in', NOW())
        ON CONFLICT (technician_id, shift_date) DO UPDATE SET status = 'clocked_in', clock_in_at = NOW()
        RETURNING ${this.cols(SHIFT_COLS)}`)!,
    clockOut: async (technicianId: string, dateStr: string) => {
      const row = await this.one<Shift>`
        UPDATE shift SET status = 'completed', clock_out_at = NOW()
        WHERE technician_id = ${technicianId} AND shift_date = ${dateStr}::date
        RETURNING ${this.cols(SHIFT_COLS)}`;
      if (!row) throw new Error(`Shift not found for technician ${technicianId} on ${dateStr}`);
      return row;
    },
    updateStatus: async (technicianId: string, dateStr: string, status: ShiftStatus) =>
      (await this.one<Shift>`
        INSERT INTO shift (technician_id, shift_date, status)
        VALUES (${technicianId}, ${dateStr}::date, ${status})
        ON CONFLICT (technician_id, shift_date) DO UPDATE SET status = ${status}
        RETURNING ${this.cols(SHIFT_COLS)}`)!,
    patch: async (
      technicianId: string,
      dateStr: string,
      patch: { status?: ShiftStatus; clockInAt?: string; clockOutAt?: string },
    ) =>
      (await this.one<Shift>`
        INSERT INTO shift (technician_id, shift_date, status, clock_in_at, clock_out_at)
        VALUES (${technicianId}, ${dateStr}::date, ${patch.status ?? 'scheduled'}, ${patch.clockInAt ?? null}, ${patch.clockOutAt ?? null})
        ON CONFLICT (technician_id, shift_date) DO UPDATE SET
          status = COALESCE(${patch.status ?? null}, shift.status),
          clock_in_at = COALESCE(${patch.clockInAt ?? null}::timestamptz, shift.clock_in_at),
          clock_out_at = COALESCE(${patch.clockOutAt ?? null}::timestamptz, shift.clock_out_at)
        RETURNING ${this.cols(SHIFT_COLS)}`)!,
    listByDate: (dateStr: string) =>
      this.q<Shift>`SELECT ${this.cols(SHIFT_COLS)} FROM shift WHERE shift_date = ${dateStr}::date ORDER BY technician_id COLLATE "C"`,
  };

  customers = {
    getById: (id: string) => this.one<Customer>`SELECT ${this.cols(CUSTOMER_COLS)} FROM customer WHERE id = ${id}`,
    getByPhone: (phone: string) => this.one<Customer>`SELECT ${this.cols(CUSTOMER_COLS)} FROM customer WHERE phone = ${phone}`,
    create: async (customer: Omit<Customer, 'id' | 'createdAt'>) =>
      (await this.one<Customer>`
        INSERT INTO customer (name, phone, email, company_name)
        VALUES (${customer.name}, ${customer.phone}, ${customer.email ?? null}, ${customer.companyName ?? null})
        RETURNING ${this.cols(CUSTOMER_COLS)}`)!,
  };

  sites = {
    getById: (id: string) => this.one<Site>`SELECT ${this.cols(SITE_COLS)} FROM site WHERE id = ${id}`,
    getByCustomerId: (customerId: string) =>
      this.q<Site>`SELECT ${this.cols(SITE_COLS)} FROM site WHERE customer_id = ${customerId} ORDER BY id COLLATE "C"`,
    getByPostalCode: (postalCode: string) =>
      this.one<Site>`SELECT ${this.cols(SITE_COLS)} FROM site WHERE postal_code = ${postalCode} ORDER BY id LIMIT 1`,
    create: async (site: Omit<Site, 'id' | 'createdAt'>) =>
      (await this.one<Site>`
        INSERT INTO site (customer_id, postal_code, region, estate_cluster, address_line1, unit_no, last_technician_id, preferred_technician_id, access_flags)
        VALUES (${site.customerId}, ${site.postalCode}, ${site.region}, ${site.estateCluster}, ${site.addressLine1}, ${site.unitNo}, ${site.lastTechnicianId ?? null}, ${site.preferredTechnicianId ?? null}, ${site.accessFlags ?? []}::text[])
        RETURNING ${this.cols(SITE_COLS)}`)!,
  };

  siteMemories = {
    getBySiteId: (siteId: string) =>
      this.q<SiteMemory>`SELECT id, site_id as "siteId", job_id as "jobId", technician_id as "technicianId", note_raw as "noteRaw", created_at as "createdAt" FROM site_memory WHERE site_id = ${siteId} ORDER BY created_at`,
    addNote: async (note: Omit<SiteMemory, 'id' | 'createdAt'>) =>
      (await this.one<SiteMemory>`
        INSERT INTO site_memory (site_id, job_id, technician_id, note_raw)
        VALUES (${note.siteId}, ${note.jobId ?? null}, ${note.technicianId ?? null}, ${note.noteRaw})
        RETURNING id, site_id as "siteId", job_id as "jobId", technician_id as "technicianId", note_raw as "noteRaw", created_at as "createdAt"`)!,
  };

  jobTypes = {
    getById: (id: string) => this.one<JobType>`SELECT ${this.cols(JOB_TYPE_COLS)} FROM job_type WHERE id = ${id}`,
    listAll: () => this.q<JobType>`SELECT ${this.cols(JOB_TYPE_COLS)} FROM job_type ORDER BY id COLLATE "C"`,
    getCerts: (jobTypeId: string) =>
      this.q<JobTypeCert>`SELECT id, job_type_id as "jobTypeId", cert_type as "certType", brand_required as "brandRequired" FROM job_type_cert WHERE job_type_id = ${jobTypeId} ORDER BY id COLLATE "C"`,
    create: async (jt: Omit<JobType, 'createdAt'>) =>
      (await this.one<JobType>`
        INSERT INTO job_type (id, name, min_tier, difficulty, default_minutes, sla_hours, brand_sensitive)
        VALUES (${jt.id}, ${jt.name}, ${jt.minTier}, ${jt.difficulty}, ${jt.defaultMinutes}, ${jt.slaHours ?? null}, ${jt.brandSensitive})
        RETURNING ${this.cols(JOB_TYPE_COLS)}`)!,
    update: async (id: string, patch: Partial<Pick<JobType, 'name' | 'minTier' | 'defaultMinutes'>>) => {
      const row = await this.one<JobType>`
        UPDATE job_type SET
          name = COALESCE(${patch.name ?? null}::text, name),
          min_tier = COALESCE(${patch.minTier ?? null}::int, min_tier),
          default_minutes = COALESCE(${patch.defaultMinutes ?? null}::int, default_minutes)
        WHERE id = ${id}
        RETURNING ${this.cols(JOB_TYPE_COLS)}`;
      if (!row) throw new Error(`Job type ${id} not found`);
      return row;
    },
    setCerts: async (jobTypeId: string, certTypes: string[]) => {
      await this.q`DELETE FROM job_type_cert WHERE job_type_id = ${jobTypeId}`;
      for (const certType of certTypes) {
        await this.q`INSERT INTO job_type_cert (job_type_id, cert_type) VALUES (${jobTypeId}, ${certType})`;
      }
      return this.jobTypes.getCerts(jobTypeId);
    },
  };

  settings = {
    get: async (): Promise<CompanySettings> => {
      const row = await this.one<CompanySettings>`
        SELECT name, day_start as "dayStart", day_end as "dayEnd", default_profile as "defaultProfile" FROM company_setting WHERE id = 'company'`;
      return { ...DEFAULT_SETTINGS, ...row };
    },
    update: async (patch: Partial<CompanySettings>): Promise<CompanySettings> => {
      const next = { ...(await this.settings.get()), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
      await this.q`
        INSERT INTO company_setting (id, name, day_start, day_end, default_profile, updated_at)
        VALUES ('company', ${next.name}, ${next.dayStart}, ${next.dayEnd}, ${next.defaultProfile}, NOW())
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, day_start = EXCLUDED.day_start,
          day_end = EXCLUDED.day_end, default_profile = EXCLUDED.default_profile, updated_at = NOW()`;
      return next;
    },
  };

  jobs = {
    getById: (id: string) => this.one<Job>`SELECT ${this.cols(JOB_COLS)} FROM job WHERE id = ${id}`,
    create: async (job: Omit<Job, 'id' | 'createdAt' | 'updatedAt'>) =>
      (await this.one<Job>`
        INSERT INTO job (customer_id, site_id, job_type_id, status, priority, window_type, lock_state, scheduled_date, window_start, window_end, duration_minutes, parts_required, tools_required, note_raw, intake_parsed, required_crew_size, board_version_at_rank, confidence_score)
        VALUES (${job.customerId}, ${job.siteId}, ${job.jobTypeId}, ${job.status}, ${job.priority}, ${job.windowType}, ${job.lockState ?? 'none'}, ${job.scheduledDate}::date, ${job.windowStart ?? null}, ${job.windowEnd ?? null}, ${job.durationMinutes ?? 60}, ${job.partsRequired ?? []}::text[], ${job.toolsRequired ?? []}::text[], ${job.noteRaw}, ${job.intakeParsed ? this.json(job.intakeParsed) : null}, ${job.requiredCrewSize}, ${job.boardVersionAtRank}, ${job.confidenceScore})
        RETURNING ${this.cols(JOB_COLS)}`)!,
    updateStatus: async (jobId: string, status: JobStatus, actorId: string, actorRole: string, reason?: string) => {
      const before = await this.jobs.getById(jobId);
      if (!before) throw new Error(`Job ${jobId} not found`);
      const row = await this.one<Job>`
        UPDATE job SET status = ${status}, updated_at = NOW() WHERE id = ${jobId}
        RETURNING ${this.cols(JOB_COLS)}`;
      await this.q`
        INSERT INTO status_event (job_id, from_status, to_status, actor_id, actor_role, reason)
        VALUES (${jobId}, ${before.status}, ${status}, ${actorId}, ${actorRole}, ${reason ?? null})`;
      return row!;
    },
    listUnassigned: () =>
      this.q<Job>`SELECT ${this.cols(JOB_COLS)} FROM job WHERE status IN ('unassigned', 'received') ORDER BY id COLLATE "C"`,
    listByScheduledDate: (dateStr: string) =>
      this.q<Job>`SELECT ${this.cols(JOB_COLS)} FROM job WHERE scheduled_date = ${dateStr}::date ORDER BY id COLLATE "C"`,
  };

  jobRequirements = {
    getByJobId: (jobId: string) =>
      this.one<JobRequirement>`SELECT ${this.cols(REQ_COLS)} FROM job_requirement WHERE job_id = ${jobId} ORDER BY id LIMIT 1`,
    create: async (req: Omit<JobRequirement, 'id' | 'createdAt'>) =>
      (await this.one<JobRequirement>`
        INSERT INTO job_requirement (job_id, min_tier, required_certs, brand_required, required_crew_size)
        VALUES (${req.jobId}, ${req.minTier}, ${req.requiredCerts}::text[], ${req.brandRequired ?? null}, ${req.requiredCrewSize})
        RETURNING ${this.cols(REQ_COLS)}`)!,
  };

  assignments = {
    getById: (id: string) => this.one<Assignment>`SELECT ${this.cols(ASSIGNMENT_COLS)} FROM assignment WHERE id = ${id}`,
    getByJobId: (jobId: string) =>
      this.q<Assignment>`SELECT ${this.cols(ASSIGNMENT_COLS)} FROM assignment WHERE job_id = ${jobId} ORDER BY offered_at, id COLLATE "C"`,
    getActiveForTechnician: (technicianId: string, dateStr: string) =>
      this.q<Assignment>`
        SELECT ${this.cols(ASSIGNMENT_COLS)} FROM assignment
        WHERE id IN (
          SELECT a.id FROM assignment a JOIN job j ON a.job_id = j.id
          WHERE a.technician_id = ${technicianId} AND j.scheduled_date = ${dateStr}::date AND a.status IN ('offered', 'accepted')
        )
        ORDER BY window_start, id`,
    listAll: () => this.q<Assignment>`SELECT ${this.cols(ASSIGNMENT_COLS)} FROM assignment ORDER BY job_id COLLATE "C", offered_at, id COLLATE "C"`,
    createCommitted: async (params: {
      jobId: string;
      technicianId: string;
      snapshotId: string;
      windowStart?: string;
      windowEnd?: string;
      travelBeforeMinutes?: number;
      metrics?: PlanMetrics;
    }) =>
      (await this.one<Assignment>`
        INSERT INTO assignment (job_id, technician_id, snapshot_id, status, window_start, window_end, travel_before_minutes, offered_at, accepted_at, score_breakdown)
        VALUES (${params.jobId}, ${params.technicianId}, ${params.snapshotId}, 'accepted', ${params.windowStart ?? null}, ${params.windowEnd ?? null}, ${params.travelBeforeMinutes ?? null}, NOW(), NOW(), ${this.json(params.metrics ?? emptyPlanMetrics())})
        RETURNING ${this.cols(ASSIGNMENT_COLS)}`)!,
    createOffer: async (params: {
      jobId: string;
      technicianId: string;
      snapshotId: string;
      expiresInMinutes?: number;
      metrics?: PlanMetrics;
      decisionLogId?: string;
    }) =>
      (await this.one<Assignment>`
        INSERT INTO assignment (job_id, technician_id, snapshot_id, offered_at, expires_at, score_breakdown, decision_log_id)
        VALUES (${params.jobId}, ${params.technicianId}, ${params.snapshotId}, NOW(), NOW() + make_interval(mins => ${params.expiresInMinutes ?? 10}), ${this.json(params.metrics ?? emptyPlanMetrics())}, ${params.decisionLogId ?? null})
        RETURNING ${this.cols(ASSIGNMENT_COLS)}`)!,
    acceptOffer: async (assignmentId: string) =>
      (await this.one<Assignment>`UPDATE assignment SET status = 'accepted', accepted_at = NOW() WHERE id = ${assignmentId} RETURNING ${this.cols(ASSIGNMENT_COLS)}`)!,
    declineOffer: async (assignmentId: string) =>
      (await this.one<Assignment>`UPDATE assignment SET status = 'declined' WHERE id = ${assignmentId} RETURNING ${this.cols(ASSIGNMENT_COLS)}`)!,
    expireOffer: async (assignmentId: string) =>
      (await this.one<Assignment>`UPDATE assignment SET status = 'expired' WHERE id = ${assignmentId} RETURNING ${this.cols(ASSIGNMENT_COLS)}`)!,
    supersede: async (assignmentId: string, status: 'reassigned' | 'cancelled') =>
      (await this.one<Assignment>`UPDATE assignment SET status = ${status} WHERE id = ${assignmentId} RETURNING ${this.cols(ASSIGNMENT_COLS)}`)!,
  };

  statusEvents = {
    getByJobId: (jobId: string) =>
      this.q<StatusEvent>`SELECT ${this.cols(STATUS_EVENT_COLS)} FROM status_event WHERE job_id = ${jobId} ORDER BY created_at, id`,
    listAll: () => this.q<StatusEvent>`SELECT ${this.cols(STATUS_EVENT_COLS)} FROM status_event ORDER BY created_at, id`,
  };

  travelMatrix = {
    getTravelMinutes: async (fromCluster: string, toCluster: string, isPeak = false) => {
      const row = await this.one<{ minutes: number; peakMinutes: number }>`
        SELECT minutes, peak_minutes AS "peakMinutes" FROM travel_matrix WHERE from_cluster = ${fromCluster} AND to_cluster = ${toCluster}`;
      if (!row) throw new Error(`TRAVEL_MATRIX_MISSING:${fromCluster}->${toCluster}`);
      return isPeak ? row.peakMinutes : row.minutes;
    },
    listAll: () => this.q<TravelMatrix>`SELECT ${this.cols(TRAVEL_COLS)} FROM travel_matrix ORDER BY from_cluster COLLATE "C", to_cluster COLLATE "C"`,
    setMatrix: async (entries: Array<{ fromCluster: string; toCluster: string; minutes: number; peakMinutes: number }>) => {
      for (const e of entries) {
        await this.q`
          INSERT INTO travel_matrix (from_cluster, to_cluster, minutes, peak_minutes, source)
          VALUES (${e.fromCluster}, ${e.toCluster}, ${e.minutes}, ${e.peakMinutes}, 'seeded')
          ON CONFLICT (from_cluster, to_cluster) DO UPDATE SET minutes = EXCLUDED.minutes, peak_minutes = EXCLUDED.peak_minutes`;
      }
    },
  };

  boardSnapshots = {
    getLatestVersion: async () =>
      (await this.one<{ v: number }>`SELECT COALESCE(MAX(version), 0)::int AS v FROM board_snapshot`)?.v ?? 0,
    getLatest: () => this.one<BoardSnapshot>`SELECT ${this.cols(SNAPSHOT_COLS)} FROM board_snapshot ORDER BY version DESC LIMIT 1`,
    getSnapshot: (version: number) =>
      this.one<BoardSnapshot>`SELECT ${this.cols(SNAPSHOT_COLS)} FROM board_snapshot WHERE version = ${version}`,
    /**
     * One statement: the next version is computed and, when a source is given,
     * the source is checked to still be the latest, together. Two commits racing
     * to the same version: the unique index makes the second fail, and that is
     * staleness too, not an outage.
     */
    createSnapshot: async (data: Record<string, unknown>, extra?: { sourceSnapshotId?: string; triggerEventId?: string }) => {
      const source = extra?.sourceSnapshotId ?? null;
      try {
        const row = await this.one<BoardSnapshot>`
          INSERT INTO board_snapshot (version, snapshot_data, source_snapshot_id, trigger_event_id, committed_at)
          SELECT COALESCE(MAX(version), 0) + 1, ${this.json(data)}, ${source}, ${extra?.triggerEventId ?? null}, NOW()
          FROM board_snapshot
          HAVING ${source}::text IS NULL
              OR ${source}::text = (SELECT id FROM board_snapshot ORDER BY version DESC LIMIT 1)
          RETURNING ${this.cols(SNAPSHOT_COLS)}`;
        if (!row) throw new StaleSnapshotError(source ?? '');
        return row;
      } catch (e) {
        if ((e as { code?: string }).code === '23505' && source) throw new StaleSnapshotError(source);
        throw e;
      }
    },
  };

  // decision_log is append-only. Every column the schema defines is written and
  // read back: event_id in particular, or listByEvent can never match anything.
  decisionLogs = {
    getById: (id: string) => this.one<DecisionLog>`SELECT ${this.cols(LOG_COLS)} FROM decision_log WHERE id = ${id}`,
    listByEvent: (eventId: string) =>
      this.q<DecisionLog>`
        SELECT ${this.cols(LOG_COLS)} FROM decision_log
        WHERE event_id = ${eventId}
        ORDER BY sequence ASC NULLS LAST, created_at ASC`,
    create: async (log: Omit<DecisionLog, 'id' | 'createdAt'>) =>
      (await this.one<DecisionLog>`
        INSERT INTO decision_log (event_id, event_type, playbook, sequence, stage, tool_calls, summary, reason_codes, duration_ms, result, approval_id)
        VALUES (
          ${log.eventId ?? null}, ${log.eventType}, ${log.playbook}, ${log.sequence ?? null},
          ${log.stage ?? null}, ${this.json(log.toolCalls)}, ${log.summary},
          ${this.json(log.reasonCodes ?? [])}, ${log.durationMs ?? null},
          ${log.result ?? null}, ${log.approvalId ?? null}
        )
        RETURNING ${this.cols(LOG_COLS)}`)!,
  };

  approvals = {
    getById: (id: string) => this.one<Approval>`SELECT ${this.cols(APPROVAL_COLS)} FROM approval WHERE id = ${id}`,
    getByProposal: (proposalId: string) =>
      this.one<Approval>`SELECT ${this.cols(APPROVAL_COLS)} FROM approval WHERE proposal_id = ${proposalId} ORDER BY created_at DESC, id DESC LIMIT 1`,
    listPending: () => this.q<Approval>`SELECT ${this.cols(APPROVAL_COLS)} FROM approval WHERE status = 'pending' ORDER BY created_at, id`,
    create: async (approval: Omit<Approval, 'id' | 'createdAt'>) =>
      (await this.one<Approval>`
        INSERT INTO approval (proposal_id, thread_id, job_id, source_snapshot_id, trigger_reason, recommendation, who_would_be_late, policy_reasons, approved_plan_id, status)
        VALUES (${approval.proposalId ?? null}, ${approval.threadId}, ${approval.jobId ?? null}, ${approval.sourceSnapshotId ?? null}, ${approval.triggerReason}, ${this.json(approval.recommendation)}, ${approval.whoWouldBeLate ? this.json(approval.whoWouldBeLate) : null}, ${this.json(approval.policyReasons ?? [])}, ${approval.approvedPlanId ?? null}, ${approval.status ?? 'pending'})
        RETURNING ${this.cols(APPROVAL_COLS)}`)!,
    action: async (id: string, status: 'approved' | 'rejected', actionedBy: string, reason?: string) =>
      (await this.one<Approval>`
        UPDATE approval SET status = ${status}, actioned_by = ${actionedBy}, actioned_reason = ${reason ?? null}, actioned_at = NOW()
        WHERE id = ${id}
        RETURNING ${this.cols(APPROVAL_COLS)}`)!,
  };

  events = {
    getById: (id: string) => this.one<OperationalEvent>`SELECT ${this.cols(EVENT_COLS)} FROM operational_event WHERE id = ${id}`,
    create: async (event: Omit<OperationalEvent, 'id' | 'receivedAt'>) =>
      (await this.one<OperationalEvent>`
        INSERT INTO operational_event (type, raw_text, normalized_payload, source_snapshot_id, affected_ids, validation_issues, status)
        VALUES (${event.type}, ${event.rawText}, ${this.json(event.normalizedPayload)}, ${event.sourceSnapshotId ?? null}, ${this.json(event.affectedIds)}, ${this.json(event.validationIssues)}, ${event.status})
        RETURNING ${this.cols(EVENT_COLS)}`)!,
    updateStatus: async (id: string, status: OperationalEventStatus) => {
      const row = await this.one<OperationalEvent>`
        UPDATE operational_event SET status = ${status} WHERE id = ${id} RETURNING ${this.cols(EVENT_COLS)}`;
      if (!row) throw new Error(`Event ${id} not found`);
      return row;
    },
  };

  proposals = {
    getById: (id: string) => this.one<Proposal>`SELECT ${this.cols(PROPOSAL_COLS)} FROM proposal WHERE id = ${id}`,
    getByEventId: (eventId: string) =>
      this.one<Proposal>`SELECT ${this.cols(PROPOSAL_COLS)} FROM proposal WHERE event_id = ${eventId} ORDER BY created_at DESC, id DESC LIMIT 1`,
    create: async (proposal: Omit<Proposal, 'id' | 'createdAt'>) =>
      (await this.one<Proposal>`
        INSERT INTO proposal (event_id, source_snapshot_id, recommended_plan_id, risk, autonomy_mode, status)
        VALUES (${proposal.eventId}, ${proposal.sourceSnapshotId}, ${proposal.recommendedPlanId ?? null}, ${proposal.risk}, ${proposal.autonomyMode}, ${proposal.status})
        RETURNING ${this.cols(PROPOSAL_COLS)}`)!,
    updateStatus: async (id: string, status: ProposalStatus, recommendedPlanId?: string) => {
      const row = await this.one<Proposal>`
        UPDATE proposal
        SET status = ${status}, recommended_plan_id = COALESCE(${recommendedPlanId ?? null}, recommended_plan_id)
        WHERE id = ${id}
        RETURNING ${this.cols(PROPOSAL_COLS)}`;
      if (!row) throw new Error(`Proposal ${id} not found`);
      return row;
    },
  };

  candidatePlans = {
    getById: (id: string) => this.one<CandidatePlan>`SELECT ${this.cols(PLAN_COLS)} FROM candidate_plan WHERE id = ${id}`,
    listByProposal: (proposalId: string) =>
      this.q<CandidatePlan>`SELECT ${this.cols(PLAN_COLS)} FROM candidate_plan WHERE proposal_id = ${proposalId} ORDER BY created_at, id`,
    create: async (plan: Omit<CandidatePlan, 'id' | 'createdAt'>) =>
      (await this.one<CandidatePlan>`
        INSERT INTO candidate_plan (proposal_id, source_snapshot_id, profile, assignments, change_set, metrics, validations, solver_trace, timed_out, duration_ms, status)
        VALUES (
          ${plan.proposalId}, ${plan.sourceSnapshotId}, ${plan.profile},
          ${this.json(plan.assignments)}, ${this.json(plan.changeSet)},
          ${this.json(plan.metrics)}, ${this.json(plan.validations)},
          ${this.json(plan.solverTrace)}, ${plan.timedOut}, ${plan.durationMs ?? null}, ${plan.status}
        )
        RETURNING ${this.cols(PLAN_COLS)}`)!,
  };
}
