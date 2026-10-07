import { describe, expect, it } from 'vitest';
import { InMemoryDatabase } from '../db/memory';
import { createJob } from './create-job';
import { buildBoardSchedule } from './board-schedule';
import { getCurrentBoard } from './current-board';
import { propose } from '../matching/propose';
import { stageA } from '../matching/gates/stage-a';
import { buildScenario } from '../shared/fixtures/scenario';
import { createJobBodySchema, type CreateJobBody } from '../shared/contracts/jobs';

const DATE = '2026-10-20';
const finals = () => new InMemoryDatabase({ scenario: () => buildScenario(DATE) });

const booking = (over: Partial<CreateJobBody> = {}): CreateJobBody =>
  createJobBodySchema.parse({
    customerName: 'Lee Mei Ling',
    phone: '+65 9123 4567',
    postalCode: '529536',
    address: 'Tampines Street 81',
    jobTypeId: 'WATER_LEAK',
    priority: 'urgent',
    windowStart: '14:00',
    windowEnd: '17:00',
    note: 'Ceiling dripping onto the sofa.',
    ...over,
  });

describe('createJobBodySchema', () => {
  it('normalises a Singapore phone number', () => {
    expect(booking().phone).toBe('91234567');
    expect(booking({ phone: '8123-4567' }).phone).toBe('81234567');
  });

  it('refuses bad input before it reaches the database', () => {
    const bad = (over: Record<string, unknown>) =>
      createJobBodySchema.safeParse({ ...booking(), phone: '91234567', ...over }).success;
    expect(bad({ phone: '1234567' })).toBe(false);
    expect(bad({ postalCode: '52953' })).toBe(false);
    expect(bad({ windowStart: '17:00', windowEnd: '14:00' })).toBe(false);
    expect(bad({ windowStart: '9:00' })).toBe(false);
    expect(bad({ priority: 'asap' })).toBe(false);
  });
});

describe('createJob', () => {
  it('books an unassigned job on today’s board, in the right area, with its requirements', async () => {
    const db = finals();
    const result = await createJob(db, booking());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.customerIsNew).toBe(true);
    expect(result.site).toMatchObject({ estateCluster: 'east', region: 'East', postalCode: '529536' });
    expect(result.job).toMatchObject({
      status: 'unassigned', priority: 'urgent', windowType: 'tight', scheduledDate: DATE,
      windowStart: `${DATE}T14:00:00+08:00`, windowEnd: `${DATE}T17:00:00+08:00`, durationMinutes: 90,
      noteRaw: 'Ceiling dripping onto the sofa.',
    });
    expect(await db.jobRequirements.getByJobId(result.job.id)).toMatchObject({ minTier: 2, requiredCerts: [] });

    const board = await getCurrentBoard(db);
    const row = board.jobs.find((r) => r.job.id === result.job.id);
    expect(row?.assignment).toBeUndefined();
    expect(row?.customer.name).toBe('Lee Mei Ling');
  });

  it('finds a returning customer by phone and reuses their site', async () => {
    const db = finals();
    const first = await createJob(db, booking());
    const again = await createJob(db, booking({ customerName: 'Mei Ling', jobTypeId: 'GENERAL_SERVICE', windowStart: '09:00', windowEnd: '11:00' }));
    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.customerIsNew).toBe(false);
    expect(again.customer.id).toBe(first.customer.id);
    expect(again.customer.name).toBe('Lee Mei Ling');
    expect(again.site.id).toBe(first.site.id);
    const elsewhere = await createJob(db, booking({ postalCode: '018989', address: 'Marina Boulevard' }));
    expect(elsewhere.ok && elsewhere.site.id).not.toBe(first.site.id);
  });

  it('gives a job with a legal-gate type the certificate requirement', async () => {
    const db = finals();
    const result = await createJob(db, booking({ jobTypeId: 'GAS_TOPUP' }));
    expect(result.ok && (await db.jobRequirements.getByJobId(result.job.id))?.requiredCerts).toEqual(['NEA_R32']);
  });

  it('refuses what cannot be booked', async () => {
    const db = finals();
    expect(await createJob(db, booking({ postalCode: '740001' }))).toMatchObject({ ok: false, code: 'unknown_postal_code' });
    expect(await createJob(db, booking({ jobTypeId: 'NOPE' }))).toMatchObject({ ok: false, code: 'unknown_job_type' });
    expect(await createJob(db, booking({ windowStart: '14:00', windowEnd: '15:00' }))).toMatchObject({ ok: false, code: 'window_too_short' });
    expect(await createJob(db, booking({ date: '2026-10-25' }))).toMatchObject({ ok: false, code: 'date_out_of_range' });
    expect(await createJob(db, booking({ date: '2026-10-21' }))).toMatchObject({ ok: true });
  });

  it('can then be planned like any waiting job', async () => {
    const db = finals();
    const result = await createJob(db, booking());
    if (!result.ok) throw new Error(result.detail);
    const schedule = await buildBoardSchedule(db);
    const eligible = stageA(result.job, schedule.technicians, schedule.certs, schedule.shifts, schedule.jobRequirements)
      .filter((e) => e.isEligible)
      .map((e) => e.technician.id);
    // Water leak: tier 2 and up. Wei, Daniel and Lina (tier 1) are out.
    expect(eligible).not.toContain('tech_wei');
    expect(eligible.length).toBeGreaterThan(5);

    const event = await db.events.create({
      type: 'urgent_job', rawText: '', normalizedPayload: { jobId: result.job.id }, sourceSnapshotId: schedule.snapshotId,
      affectedIds: [result.job.id], validationIssues: [], status: 'VALIDATED',
    });
    const out = propose({ event, schedule, profile: 'sla_first' });
    expect(out.plans).toHaveLength(2);
    for (const plan of out.plans) {
      expect(plan.validations.violations, plan.profile).toEqual([]);
      const slot = plan.assignments.find((a) => a.jobId === result.job.id);
      expect(eligible).toContain(slot?.technicianId);
    }
  });
});
