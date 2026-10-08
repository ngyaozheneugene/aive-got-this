/**
 * The Postgres adapter against a real database, held to the in-memory one.
 *
 * Every caller was written and tested against InMemoryDatabase, so "works on
 * Postgres" means "returns what memory returns". Each read path is compared
 * row for row on the same seed, then the real commit loop runs on Postgres.
 *
 * Needs a throwaway database; every test truncates it.
 *
 *   docker compose up -d postgres
 *   docker exec aive-postgres psql -U dispatch -c "CREATE DATABASE dispatch_test"
 *   RUN_POSTGRES_TESTS=1 npx vitest run src/db/postgres
 *
 * DATABASE_URL_TEST overrides the default postgres://dispatch:dispatch@localhost:5432/dispatch_test.
 */
import { createJobType, listJobTypes, updateJobType, updateSettings } from '../../dispatch/settings';
import { createJobTypeBodySchema } from '../../shared/contracts/settings';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { InMemoryDatabase } from '../memory';
import { PostgresDatabase } from './index';
import { migrate } from './migrate';
import type { IDatabase } from '../interface';
import { buildBoardSchedule } from '../../dispatch/board-schedule';
import { getCurrentBoard } from '../../dispatch/current-board';
import { commitPlan } from '../../dispatch/commit';
import { recordDecision } from '../../dispatch/decision';
import { createJob } from '../../dispatch/create-job';
import { createTechnician, listTeam, updateTechnician } from '../../dispatch/technicians';
import { createTechnicianBodySchema } from '../../shared/contracts/technicians';
import { buildEmptyScenario } from '../../shared/fixtures/scenario';
import { createJobBodySchema } from '../../shared/contracts/jobs';
import { propose } from '../../matching/propose';
import { EASTWIND, type Scenario } from '../../shared/fixtures/eastwind';
import { buildScenario } from '../../shared/fixtures/scenario';
import { addDays } from '../../shared/config/demo';
import type { CandidatePlan } from '../../shared/types/domain';

const enabled = process.env.RUN_POSTGRES_TESTS === '1';
const URL = process.env.DATABASE_URL_TEST ?? 'postgres://dispatch:dispatch@localhost:5432/dispatch_test';
const FINALS_DATE = '2026-10-20';

const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));

/** Both adapters seeded with the same scenario. */
async function pair(scenario: () => Scenario) {
  const pg = new PostgresDatabase({ url: URL, scenario });
  await pg.reset();
  return { pg, mem: new InMemoryDatabase({ scenario }) };
}

async function everyRead(db: IDatabase, data: Scenario) {
  const days = [...new Set(data.jobs.map((j) => j.scheduledDate))];
  const techs = byId(await db.technicians.listAll());
  return {
    users: await Promise.all(data.users.map((u) => db.users.getById(u.id))),
    technicians: techs,
    active: byId(await db.technicians.listActive()),
    certs: byId((await Promise.all(techs.map((t) => db.technicians.getCerts(t.id)))).flat()),
    shifts: byId((await Promise.all(days.map((d) => db.shifts.listByDate(d)))).flat()),
    customers: await Promise.all(data.customers.map((c) => db.customers.getById(c.id))),
    sites: await Promise.all(data.sites.map((s) => db.sites.getById(s.id))),
    jobTypes: byId(await db.jobTypes.listAll()),
    jobTypeCerts: byId((await Promise.all(data.jobTypes.map((t) => db.jobTypes.getCerts(t.id)))).flat()),
    jobs: byId((await Promise.all(days.map((d) => db.jobs.listByScheduledDate(d)))).flat()),
    requirements: await Promise.all(data.jobs.map((j) => db.jobRequirements.getByJobId(j.id))),
    assignments: byId(await db.assignments.listAll()),
    travel: [...(await db.travelMatrix.listAll())].sort((a, b) =>
      `${a.fromCluster}>${a.toCluster}`.localeCompare(`${b.fromCluster}>${b.toCluster}`),
    ),
    latest: await db.boardSnapshots.getLatest(),
    version: await db.boardSnapshots.getLatestVersion(),
  };
}

function sortSchedule(s: Awaited<ReturnType<typeof buildBoardSchedule>>) {
  return {
    ...s,
    technicians: byId(s.technicians),
    jobs: byId(s.jobs),
    assignments: byId(s.assignments),
    certs: byId(s.certs),
    shifts: byId(s.shifts),
    jobRequirements: byId(s.jobRequirements),
    sites: byId(s.sites),
    travel: byId(s.travel),
  };
}

async function storeProposal(db: IDatabase, eventId: string, sourceSnapshotId: string, plans: CandidatePlan[]) {
  const proposal = await db.proposals.create({
    eventId, sourceSnapshotId, risk: 'medium', autonomyMode: 'approval', status: 'RECOMMENDED',
  });
  const saved: CandidatePlan[] = [];
  for (const plan of plans) {
    saved.push(await db.candidatePlans.create({
      proposalId: proposal.id, sourceSnapshotId, profile: plan.profile, assignments: plan.assignments,
      changeSet: plan.changeSet, metrics: plan.metrics, validations: plan.validations, solverTrace: plan.solverTrace,
      timedOut: plan.timedOut, durationMs: plan.durationMs, status: 'VALIDATED',
    }));
  }
  return { proposal, saved };
}

describe.skipIf(!enabled)('Postgres adapter', () => {
  const open: PostgresDatabase[] = [];
  const track = (db: PostgresDatabase) => (open.push(db), db);
  afterAll(async () => {
    await Promise.all(open.map((db) => db.close()));
  });

  describe('migrations', () => {
    let sql: postgres.Sql;
    beforeAll(() => {
      sql = postgres(URL, { onnotice: () => {} });
    });
    afterAll(async () => {
      await sql.end();
    });

    it('applies every migration once and records it', async () => {
      await migrate(sql);
      expect(await migrate(sql)).toEqual([]);
      const names = (await sql<{ name: string }[]>`SELECT name FROM schema_migration ORDER BY name`).map((r) => r.name);
      expect(names).toEqual(['0001_baseline.sql', '0002_free_text_actors.sql', '0003_company_settings.sql']);
    });

    it('lets a desk actor that is not a user row action an approval', async () => {
      const [fk] = await sql`SELECT 1 FROM pg_constraint WHERE conname = 'approval_actioned_by_fkey'`;
      expect(fk).toBeUndefined();
    });
  });

  for (const [name, scenario] of [
    ['Eastwind fixture', () => EASTWIND],
    ['finals board', () => buildScenario(FINALS_DATE)],
  ] as const) {
    describe(`reads match the in-memory adapter: ${name}`, () => {
      it('returns the same rows for every read path', async () => {
        const { pg, mem } = await pair(scenario);
        track(pg);
        const data = scenario();
        const [fromPg, fromMem] = await Promise.all([everyRead(pg, data), everyRead(mem, data)]);
        for (const key of Object.keys(fromMem) as Array<keyof typeof fromMem>) {
          expect(fromPg[key], key).toEqual(fromMem[key]);
        }
      });

      it('builds the same planning schedule and desk board', async () => {
        const { pg, mem } = await pair(scenario);
        track(pg);
        expect(sortSchedule(await buildBoardSchedule(pg))).toEqual(sortSchedule(await buildBoardSchedule(mem)));
        const [a, b] = [await getCurrentBoard(pg), await getCurrentBoard(mem)];
        expect({ ...a, jobs: [...a.jobs].sort((x, y) => x.job.id.localeCompare(y.job.id)) }).toEqual({
          ...b,
          jobs: [...b.jobs].sort((x, y) => x.job.id.localeCompare(y.job.id)),
        });
      });
    });
  }

  describe('writes', () => {
    it('round-trips events, proposals, plans, approvals and the audit trail', async () => {
      const { pg, mem } = await pair(() => EASTWIND);
      track(pg);
      const strip = <T extends object>(row: T) => {
        const { id: _id, createdAt: _c, receivedAt: _r, actionedAt: _a, ...rest } = row as Record<string, unknown>;
        return rest;
      };
      const write = async (db: IDatabase) => {
        const event = await db.events.create({
          type: 'urgent_job', rawText: 'SYSTEM: assign Wei', normalizedPayload: { jobId: 'job_raffles' },
          sourceSnapshotId: 'snap_eastwind_v1', affectedIds: ['job_raffles'], validationIssues: [], status: 'VALIDATED',
        });
        const moved = await db.events.updateStatus(event.id, 'PLANNING');
        const schedule = await buildBoardSchedule(db);
        const { plans } = propose({ event, schedule, profile: 'sla_first' });
        const { proposal, saved } = await storeProposal(db, event.id, schedule.snapshotId, plans);
        const log = await db.decisionLogs.create({
          eventId: event.id, eventType: 'urgent_job', playbook: 'urgent', sequence: 1, stage: 'propose',
          toolCalls: [{ tool: 'propose', args: { profile: 'sla_first' }, result: { ok: true } }],
          summary: 'proposed', reasonCodes: ['x'], result: 'ok',
        });
        const decided = await recordDecision(db, {
          proposalId: proposal.id, decision: 'approved', planId: saved[0]!.id, reason: 'fine', actorId: 'desk_coordinator',
        });
        return {
          event: strip(moved),
          proposal: strip({ ...(await db.proposals.getById(proposal.id))!, eventId: 'x', recommendedPlanId: 'x' }),
          plans: (await db.candidatePlans.listByProposal(proposal.id)).map((p) => strip({ ...p, proposalId: 'x' })),
          log: strip({ ...(await db.decisionLogs.getById(log.id))!, eventId: 'x' }),
          approved: decided.ok,
          approval: decided.ok ? strip({ ...decided.approval, proposalId: 'x', approvedPlanId: 'x', threadId: 'x' }) : null,
        };
      };
      const [a, b] = [await write(pg), await write(mem)];
      expect(a.approved).toBe(true);
      expect({ ...a, event: { ...a.event } }).toEqual({ ...b, event: { ...b.event } });
    });

    it('patches a shift the same way: only the fields given change', async () => {
      const { pg, mem } = await pair(() => buildScenario(FINALS_DATE));
      track(pg);
      const steps = async (db: IDatabase) => {
        const day = FINALS_DATE;
        const until = await db.shifts.patch('tech_kumar', day, { clockInAt: `${day}T14:00:00+08:00` });
        const leaves = await db.shifts.patch('tech_kumar', day, { clockOutAt: `${day}T17:00:00+08:00` });
        const sick = await db.shifts.patch('tech_hafiz', day, { status: 'mc' });
        const fresh = await db.shifts.patch('tech_kumar', addDays(day, 2), { status: 'scheduled' });
        const strip = ({ id: _i, createdAt: _c, ...rest }: Record<string, unknown>) => rest;
        return [until, leaves, sick, fresh].map((row) => strip(row as unknown as Record<string, unknown>));
      };
      expect(await steps(pg)).toEqual(await steps(mem));
    });

    it('books a new job the same way, and finds the returning customer', async () => {
      const { pg, mem } = await pair(() => buildScenario(FINALS_DATE));
      track(pg);
      const body = createJobBodySchema.parse({
        customerName: 'Lee Mei Ling', phone: '91234567', postalCode: '529536', address: 'Tampines Street 81',
        jobTypeId: 'GAS_TOPUP', priority: 'urgent', windowStart: '14:00', windowEnd: '17:00', note: 'Not cooling.',
      });
      const strip = (row: object, ...keys: string[]) =>
        Object.fromEntries(Object.entries(row).filter(([k]) => !['id', 'createdAt', 'updatedAt', ...keys].includes(k)));
      const book = async (db: IDatabase) => {
        const first = await createJob(db, body);
        const again = await createJob(db, { ...body, windowStart: '09:00', windowEnd: '11:00' });
        if (!first.ok || !again.ok) throw new Error('booking refused');
        return {
          job: strip(first.job, 'customerId', 'siteId'),
          customer: strip(first.customer),
          site: strip(first.site, 'customerId'),
          requirement: strip((await db.jobRequirements.getByJobId(first.job.id))!, 'jobId'),
          sameCustomer: again.customer.id === first.customer.id,
          sameSite: again.site.id === first.site.id,
          onBoard: (await getCurrentBoard(db)).jobs.some((r) => r.job.id === first.job.id),
        };
      };
      expect(await book(pg)).toEqual(await book(mem));
    });

    it('adds and edits technicians the same way', async () => {
      const { pg, mem } = await pair(() => buildEmptyScenario(FINALS_DATE));
      track(pg);
      const strip = ({ id: _i, createdAt: _c, ...rest }: Record<string, unknown>) => rest;
      const steps = async (db: IDatabase) => {
        const made = await createTechnician(db, createTechnicianBodySchema.parse({
          name: 'Aisha', tier: 3, homePostalCode: '310123', certs: [{ type: 'NEA_R32', expiresAt: '2027-06-30' }], parts: ['inverter_board'],
        }));
        if (!made.ok) throw new Error(made.detail);
        await updateTechnician(db, made.technician.id, { tier: 4, homePostalCode: '640441', certs: [{ type: 'WSH_PASS' }, { type: 'EMA_LEW' }] });
        await updateTechnician(db, made.technician.id, { isActive: false });
        return (await listTeam(db)).map((t) => ({
          ...strip(t as unknown as Record<string, unknown>),
          certs: t.certs.map((c) => strip({ ...c, technicianId: 'x' } as unknown as Record<string, unknown>)).sort((a, b) => String(a.certType).localeCompare(String(b.certType))),
        }));
      };
      expect(await steps(pg)).toEqual(await steps(mem));
    });

    it('stores settings and job types the same way', async () => {
      const { pg, mem } = await pair(() => buildScenario(FINALS_DATE));
      track(pg);
      const steps = async (db: IDatabase) => {
        const before = await db.settings.get();
        await updateSettings(db, { name: 'Coolwave', dayStart: '07:30' });
        const made = await createJobType(db, createJobTypeBodySchema.parse({ name: 'Duct cleaning', minTier: 2, defaultMinutes: 120, certs: ['WSH_PASS', 'NITEC_HVAC'] }));
        if (!made.ok) throw new Error(made.detail);
        await updateJobType(db, made.jobType.id, { minTier: 3, certs: ['NEA_R32'] });
        const types = (await listJobTypes(db)).map(({ createdAt: _c, ...t }) => ({ ...t, certs: [...t.certs].sort() }));
        const after = await db.settings.get();
        await db.reset();
        return { before, after, types, reset: await db.settings.get() };
      };
      expect(await steps(pg)).toEqual(await steps(mem));
    });

    it('keeps two workspace schemas apart: a reset in one never touches the other', async () => {
      const live = track(new PostgresDatabase({ url: URL, schema: 'test_live', scenario: () => buildEmptyScenario(FINALS_DATE) }));
      const sim = track(new PostgresDatabase({ url: URL, schema: 'test_simulation', scenario: () => buildScenario(FINALS_DATE) }));
      await live.reset();
      await sim.reset();
      const made = await createTechnician(live, createTechnicianBodySchema.parse({ name: 'Real person', tier: 2, homePostalCode: '520123' }));
      expect(made.ok).toBe(true);
      expect((await live.technicians.listAll()).map((t) => t.name)).toEqual(['Real person']);
      expect(await sim.technicians.listAll()).toHaveLength(15);

      await sim.reset();
      expect((await live.technicians.listAll()).map((t) => t.name)).toEqual(['Real person']);
      expect((await getCurrentBoard(live)).date).not.toBe(FINALS_DATE); // follows the clock
    });

    it('rolls a transaction back when it throws', async () => {
      const pg = track(new PostgresDatabase({ url: URL }));
      await pg.reset();
      await expect(
        pg.transaction(async (tx) => {
          await tx.boardSnapshots.createSnapshot({ date: 'x' });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await pg.boardSnapshots.getLatestVersion()).toBe(1);
    });

    it('refuses a snapshot against a board that has moved on', async () => {
      const pg = track(new PostgresDatabase({ url: URL }));
      await pg.reset();
      await pg.boardSnapshots.createSnapshot({ date: 'x' }, { sourceSnapshotId: 'snap_eastwind_v1' });
      await expect(
        pg.boardSnapshots.createSnapshot({ date: 'x' }, { sourceSnapshotId: 'snap_eastwind_v1' }),
      ).rejects.toMatchObject({ name: 'StaleSnapshotError' });
      expect(await pg.boardSnapshots.getLatestVersion()).toBe(2);
    });
  });

  describe('the commit loop on Postgres', () => {
    async function readyToCommit(db: IDatabase) {
      const snapshot = (await db.boardSnapshots.getLatest())!;
      const event = await db.events.create({
        type: 'urgent_job', rawText: '', normalizedPayload: { jobId: 'job_raffles' },
        sourceSnapshotId: snapshot.id, affectedIds: ['job_raffles'], validationIssues: [], status: 'VALIDATED',
      });
      const schedule = await buildBoardSchedule(db);
      const { plans } = propose({ event, schedule, profile: 'sla_first' });
      const { proposal, saved } = await storeProposal(db, event.id, schedule.snapshotId, plans);
      const planId = saved.find((p) => p.profile === 'sla_first')!.id;
      const decided = await recordDecision(db, {
        proposalId: proposal.id, decision: 'approved', planId, reason: 'ok', actorId: 'desk_coordinator',
      });
      expect(decided.ok).toBe(true);
      return { proposal, planId, sourceSnapshotId: schedule.snapshotId };
    }

    it('commits Raffles Place to v2, and a reset brings the seeded day back', async () => {
      const pg = track(new PostgresDatabase({ url: URL, scenario: () => buildScenario(FINALS_DATE) }));
      await pg.reset();
      const { proposal, planId, sourceSnapshotId } = await readyToCommit(pg);

      const done = await commitPlan(pg, { proposalId: proposal.id, planId, sourceSnapshotId, actorId: 'desk_coordinator' });
      expect(done.ok, JSON.stringify(done)).toBe(true);
      const board = await getCurrentBoard(pg);
      expect(board.snapshot.version).toBe(2);
      expect(board.date).toBe(FINALS_DATE);
      expect(board.jobs.find((r) => r.job.id === 'job_raffles')?.technician).toBeDefined();
      expect((await getCurrentBoard(pg, addDays(FINALS_DATE, 1))).jobs.length).toBeGreaterThan(0);

      const again = await commitPlan(pg, { proposalId: proposal.id, planId, sourceSnapshotId, actorId: 'desk_coordinator' });
      expect(again).toMatchObject({ ok: false, code: 'already_committed', httpStatus: 409 });

      await pg.reset();
      const fresh = await getCurrentBoard(pg);
      expect(fresh.snapshot.version).toBe(1);
      expect(fresh.jobs.find((r) => r.job.id === 'job_raffles')?.technician).toBeUndefined();
    });

    it('lets exactly one of two racing commits through', async () => {
      const pg = track(new PostgresDatabase({ url: URL, scenario: () => buildScenario(FINALS_DATE) }));
      await pg.reset();
      const first = await readyToCommit(pg);
      const second = await readyToCommit(pg);
      const results = await Promise.all([first, second].map((c) =>
        commitPlan(pg, { proposalId: c.proposal.id, planId: c.planId, sourceSnapshotId: c.sourceSnapshotId, actorId: 'desk_coordinator' }),
      ));
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.find((r) => !r.ok)).toMatchObject({ code: 'stale_snapshot', httpStatus: 409 });
      expect(await pg.boardSnapshots.getLatestVersion()).toBe(2);
      // The loser wrote nothing: Raffles Place has exactly one live booking.
      const live = (await pg.assignments.getByJobId('job_raffles')).filter((a) => a.status === 'accepted');
      expect(live).toHaveLength(1);
    });

    it('seeds itself on first use of an empty database', async () => {
      const wipe = postgres(URL, { onnotice: () => {} });
      await wipe`TRUNCATE board_snapshot CASCADE`;
      await wipe.end();
      const pg = track(new PostgresDatabase({ url: URL, scenario: () => buildScenario(FINALS_DATE) }));
      expect((await getCurrentBoard(pg)).date).toBe(FINALS_DATE);
    });
  });
});
