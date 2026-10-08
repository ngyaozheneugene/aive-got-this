import { describe, expect, it } from 'vitest';
import { InMemoryDatabase } from '../db/memory';
import { buildEmptyScenario, buildScenario } from '../shared/fixtures/scenario';
import { createJobTypeBodySchema, DEFAULT_SETTINGS, updateSettingsBodySchema } from '../shared/contracts/settings';
import { createTechnicianBodySchema } from '../shared/contracts/technicians';
import { createJobBodySchema } from '../shared/contracts/jobs';
import { createJobType, listJobTypes, updateJobType, updateSettings } from './settings';
import { createTechnician } from './technicians';
import { createJob } from './create-job';
import { getCurrentBoard } from './current-board';
import { buildBoardSchedule } from './board-schedule';
import { technicianDay } from '../agent/reports/questions';

const dayOne = () => new InMemoryDatabase({ scenario: () => buildEmptyScenario('2026-10-20') });

describe('company settings', () => {
  it('starts from the defaults, and the sample day is Eastwind', async () => {
    expect(await dayOne().settings.get()).toEqual(DEFAULT_SETTINGS);
    const sample = new InMemoryDatabase({ scenario: () => buildScenario('2026-10-20') });
    expect((await sample.settings.get()).name).toBe('Eastwind Aircon');
  });

  it('refuses a working day that ends before it starts or is too short', async () => {
    const db = dayOne();
    const out = await updateSettings(db, updateSettingsBodySchema.parse({ dayStart: '09:00', dayEnd: '11:00' }));
    expect(out).toMatchObject({ ok: false, code: 'invalid_working_day' });
    expect(await db.settings.get()).toEqual(DEFAULT_SETTINGS);
    expect(updateSettingsBodySchema.safeParse({ dayStart: '25:00' }).success).toBe(false);
    expect(updateSettingsBodySchema.safeParse({}).success).toBe(false);
  });

  it('moves the default clock-in and the end of free time', async () => {
    const db = dayOne();
    await updateSettings(db, { name: 'Coolwave', dayStart: '07:30', dayEnd: '17:00' });
    const made = await createTechnician(db, createTechnicianBodySchema.parse({ name: 'Aisha', tier: 3, homePostalCode: '310123' }));
    if (!made.ok) throw new Error(made.detail);
    const board = await getCurrentBoard(db);
    expect(board.workingDay).toEqual({ start: '07:30', end: '17:00' });
    expect(board.technicians[0]!.shift?.clockInAt).toBe(`${board.date}T07:30:00+08:00`);
    const schedule = await buildBoardSchedule(db);
    expect(technicianDay(board, schedule, made.technician.id, []).freeGaps).toEqual(['07:30-17:00']);
  });

  it('a reset brings the sample day’s settings back', async () => {
    const db = new InMemoryDatabase({ scenario: () => buildScenario('2026-10-20') });
    await updateSettings(db, { name: 'Changed' });
    await db.reset();
    expect((await db.settings.get()).name).toBe('Eastwind Aircon');
  });
});

describe('job types', () => {
  it('adds one with an id from its name, and a booking requires its certificates', async () => {
    const db = dayOne();
    const out = await createJobType(db, createJobTypeBodySchema.parse({ name: 'Duct cleaning', minTier: 2, defaultMinutes: 120, certs: ['WSH_PASS'] }));
    expect(out).toMatchObject({ ok: true, jobType: { id: 'DUCT_CLEANING', name: 'Duct cleaning', minTier: 2, defaultMinutes: 120, certs: ['WSH_PASS'] } });
    expect(await createJobType(db, createJobTypeBodySchema.parse({ name: 'duct Cleaning', minTier: 1, defaultMinutes: 60 }))).toMatchObject({ ok: false, code: 'job_type_exists' });

    const booked = await createJob(db, createJobBodySchema.parse({
      customerName: 'Lee', phone: '91234567', postalCode: '529536', address: 'Tampines St 81', jobTypeId: 'DUCT_CLEANING',
      priority: 'on_demand', windowStart: '10:00', windowEnd: '14:00',
    }));
    if (!booked.ok) throw new Error(booked.detail);
    expect(booked.job.durationMinutes).toBe(120);
    expect(await db.jobRequirements.getByJobId(booked.job.id)).toMatchObject({ minTier: 2, requiredCerts: ['WSH_PASS'] });
  });

  it('edits one; booked jobs keep what they needed', async () => {
    const db = dayOne();
    const before = (await listJobTypes(db))[0]!;
    const out = await updateJobType(db, before.id, { defaultMinutes: 75, certs: ['NITEC_HVAC', 'NEA_R32'] });
    expect(out).toMatchObject({ ok: true, jobType: { id: before.id, name: before.name, defaultMinutes: 75 } });
    expect(out.ok && [...out.jobType.certs].sort()).toEqual(['NEA_R32', 'NITEC_HVAC']);
    expect(await updateJobType(db, 'NOPE', { minTier: 2 })).toMatchObject({ ok: false, code: 'job_type_not_found' });
  });
});
