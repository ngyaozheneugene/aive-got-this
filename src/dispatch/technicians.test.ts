import { describe, expect, it } from 'vitest';
import { InMemoryDatabase } from '../db/memory';
import { buildEmptyScenario } from '../shared/fixtures/scenario';
import { singaporeToday } from '../shared/config/demo';
import { createTechnicianBodySchema, updateTechnicianBodySchema } from '../shared/contracts/technicians';
import { createJobBodySchema } from '../shared/contracts/jobs';
import { createTechnician, createTechniciansBulk, listTeam, updateTechnician } from './technicians';
import { createJob } from './create-job';
import { boardDate } from './board-date';
import { buildBoardSchedule } from './board-schedule';
import { getCurrentBoard } from './current-board';
import { propose } from '../matching/propose';
import { stageA } from '../matching/gates/stage-a';

// A company on day one. Its board follows the calendar.
const dayOne = () => new InMemoryDatabase({ scenario: () => buildEmptyScenario('2026-10-01') });

const aisha = createTechnicianBodySchema.parse({
  name: 'Aisha', tier: 3, homePostalCode: '310123', certs: [{ type: 'NITEC_HVAC' }, { type: 'NEA_R32', expiresAt: '2027-06-30' }],
  parts: ['inverter_board'],
});
const ben = createTechnicianBodySchema.parse({ name: 'Ben', tier: 1, homePostalCode: '520123' });

describe('day one: an empty workspace', () => {
  it('starts with nobody and nothing, on today’s date', async () => {
    const db = dayOne();
    const board = await getCurrentBoard(db);
    expect(board.technicians).toEqual([]);
    expect(board.jobs).toEqual([]);
    expect(board.date).toBe(singaporeToday());
    expect(await boardDate(db)).toBe(singaporeToday());
    expect((await db.jobTypes.listAll()).length).toBe(6);
  });

  it('adds technicians who are placed by postal code and work today without a shift being entered', async () => {
    const db = dayOne();
    const result = await createTechnician(db, aisha);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.technician).toMatchObject({ name: 'Aisha', tier: 3, currentCluster: 'central', homeRegion: 'Central', parts: ['inverter_board'], isActive: true });
    expect(result.technician.certs.map((c) => [c.certType, c.isLegalGate, c.expiresAt])).toEqual(
      expect.arrayContaining([['NITEC_HVAC', false, undefined], ['NEA_R32', true, '2027-06-30']]),
    );

    const board = await getCurrentBoard(db);
    expect(board.technicians).toHaveLength(1);
    expect(board.technicians[0]!.shift).toMatchObject({ status: 'scheduled', clockInAt: `${board.date}T08:00:00+08:00` });
  });

  it('plans a booked job onto the people it has, legally', async () => {
    const db = dayOne();
    await createTechnician(db, aisha);
    await createTechnician(db, ben);
    const booked = await createJob(db, createJobBodySchema.parse({
      customerName: 'Tan', phone: '91234567', postalCode: '307683', address: 'Thomson Road',
      jobTypeId: 'GAS_TOPUP', priority: 'urgent', windowStart: '10:00', windowEnd: '14:00',
    }));
    if (!booked.ok) throw new Error(booked.detail);

    const schedule = await buildBoardSchedule(db);
    const eligible = stageA(booked.job, schedule.technicians, schedule.certs, schedule.shifts, schedule.jobRequirements)
      .filter((e) => e.isEligible).map((e) => e.technician.name);
    // A gas top-up needs tier 2 and R32: Aisha, not Ben.
    expect(eligible).toEqual(['Aisha']);

    const event = await db.events.create({
      type: 'urgent_job', rawText: '', normalizedPayload: { jobId: booked.job.id }, sourceSnapshotId: schedule.snapshotId,
      affectedIds: [booked.job.id], validationIssues: [], status: 'VALIDATED',
    });
    const out = propose({ event, schedule, profile: 'sla_first' });
    expect(out.plans.length).toBeGreaterThan(0);
    for (const plan of out.plans) {
      expect(plan.validations.violations).toEqual([]);
      expect(schedule.technicians.find((t) => t.id === plan.assignments.find((a) => a.jobId === booked.job.id)?.technicianId)?.name).toBe('Aisha');
    }
  });
});

describe('editing the team', () => {
  it('changes only what is sent, replaces certificates, and can take someone off the team', async () => {
    const db = dayOne();
    const made = await createTechnician(db, aisha);
    if (!made.ok) throw new Error();
    const id = made.technician.id;

    const moved = await updateTechnician(db, id, updateTechnicianBodySchema.parse({ homePostalCode: '640441', certs: [{ type: 'WSH_PASS' }] }));
    expect(moved.ok && moved.technician).toMatchObject({ name: 'Aisha', tier: 3, currentCluster: 'west', homeRegion: 'West' });
    expect(moved.ok && moved.technician.certs.map((c) => c.certType)).toEqual(['WSH_PASS']);

    await updateTechnician(db, id, updateTechnicianBodySchema.parse({ isActive: false }));
    expect((await getCurrentBoard(db)).technicians).toEqual([]);
    expect((await listTeam(db)).map((t) => [t.name, t.isActive])).toEqual([['Aisha', false]]);
  });

  it('refuses what it cannot place or find', async () => {
    const db = dayOne();
    expect(await createTechnician(db, { ...ben, homePostalCode: '740001' })).toMatchObject({ ok: false, code: 'unknown_postal_code' });
    expect(await updateTechnician(db, 'nobody', { name: 'X' })).toMatchObject({ ok: false, code: 'technician_not_found' });
    expect(createTechnicianBodySchema.safeParse({ ...ben, certs: [{ type: 'NEA_R32' }, { type: 'NEA_R32' }] }).success).toBe(false);
    expect(createTechnicianBodySchema.safeParse({ ...ben, tier: 5 }).success).toBe(false);
    expect(updateTechnicianBodySchema.safeParse({}).success).toBe(false);
  });

  it('creates technicians in bulk atomically', async () => {
    const db = dayOne();
    const result = await createTechniciansBulk(db, [aisha, ben]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(2);
    expect(result.technicians.map((t) => t.name)).toEqual(['Aisha', 'Ben']);

    const board = await getCurrentBoard(db);
    expect(board.technicians).toHaveLength(2);
  });

  it('fails bulk creation atomically if any postal code is invalid', async () => {
    const db = dayOne();
    const bad = { ...ben, name: 'Invalid', homePostalCode: '999999' };
    const result = await createTechniciansBulk(db, [aisha, bad]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('unknown_postal_code');

    // Nothing was created
    const team = await listTeam(db);
    expect(team).toHaveLength(0);
  });
});
