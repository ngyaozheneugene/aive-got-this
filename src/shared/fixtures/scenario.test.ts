import { describe, expect, it } from 'vitest';
import { addDays } from '../config/demo';
import { buildScenario, scenarioDriveMinutes } from './scenario';
import { stageA } from '../../matching/gates/stage-a';

const DATE = '2026-10-20';
const s = buildScenario(DATE);

function unique(ids: string[]) {
  return new Set(ids).size === ids.length;
}

describe('finals scenario: shape', () => {
  it('is a fleet-sized board over two days', () => {
    expect(s.technicians).toHaveLength(15);
    const today = s.jobs.filter((j) => j.scheduledDate === DATE);
    const tomorrow = s.jobs.filter((j) => j.scheduledDate === addDays(DATE, 1));
    expect(today.length).toBeGreaterThanOrEqual(40);
    expect(tomorrow.length).toBeGreaterThanOrEqual(15);
    expect(today.length + tomorrow.length).toBe(s.jobs.length);
  });

  it('is dated from the day it is built, not a fixed date', () => {
    const later = buildScenario('2027-01-05');
    expect(later.date).toBe('2027-01-05');
    expect(later.snapshot.snapshotData).toMatchObject({ date: '2027-01-05' });
    expect(later.jobs.every((j) => j.windowStart!.startsWith('2027-01-0'))).toBe(true);
    expect(s.snapshot.snapshotData).toMatchObject({ date: DATE });
  });

  it('has unique ids and no dangling references', () => {
    for (const rows of [s.technicians, s.jobs, s.sites, s.customers, s.certs, s.shifts, s.assignments, s.jobRequirements]) {
      expect(unique(rows.map((r) => r.id))).toBe(true);
    }
    const techs = new Set(s.technicians.map((t) => t.id));
    const jobTypes = new Set(s.jobTypes.map((t) => t.id));
    const customers = new Set(s.customers.map((c) => c.id));
    for (const site of s.sites) expect(customers.has(site.customerId)).toBe(true);
    for (const job of s.jobs) {
      expect(jobTypes.has(job.jobTypeId), job.id).toBe(true);
      expect(s.sites.some((x) => x.id === job.siteId && x.customerId === job.customerId), job.id).toBe(true);
    }
    for (const a of s.assignments) {
      expect(techs.has(a.technicianId)).toBe(true);
      expect(s.jobs.some((j) => j.id === a.jobId)).toBe(true);
    }
  });

  it('gives every job a requirement derived from its type, because Stage A reads only those', () => {
    for (const job of s.jobs) {
      const req = s.jobRequirements.find((r) => r.jobId === job.id);
      const type = s.jobTypes.find((t) => t.id === job.jobTypeId)!;
      expect(req, job.id).toBeDefined();
      expect(req!.minTier).toBe(type.minTier);
      const typeCerts = s.jobTypeCerts.filter((c) => c.jobTypeId === type.id).map((c) => c.certType);
      expect([...req!.requiredCerts].sort()).toEqual([...typeCerts].sort());
    }
  });

  it('has a full travel matrix over every cluster a site uses', () => {
    const clusters = [...new Set(s.sites.map((x) => x.estateCluster))];
    for (const from of clusters) {
      for (const to of clusters) {
        expect(s.travel.some((t) => t.fromCluster === from && t.toCluster === to), `${from}->${to}`).toBe(true);
      }
    }
  });
});

describe('finals scenario: the seeded day is workable', () => {
  const byId = new Map(s.jobs.map((j) => [j.id, j]));

  it('books every slot inside its customer window, at the job duration', () => {
    for (const a of s.assignments) {
      const job = byId.get(a.jobId)!;
      expect(Date.parse(a.windowStart!) >= Date.parse(job.windowStart!), a.jobId).toBe(true);
      expect(Date.parse(a.windowEnd!) <= Date.parse(job.windowEnd!), a.jobId).toBe(true);
      expect((Date.parse(a.windowEnd!) - Date.parse(a.windowStart!)) / 60000).toBe(job.durationMinutes);
    }
  });

  it('only books technicians Stage A allows for the job', () => {
    for (const a of s.assignments) {
      const job = byId.get(a.jobId)!;
      const verdict = stageA(job, s.technicians, s.certs, s.shifts, s.jobRequirements)
        .find((e) => e.technician.id === a.technicianId)!;
      expect(verdict.exclusionReasons, `${a.technicianId} on ${a.jobId}`).toEqual([]);
    }
  });

  it('leaves room in every day: no technician is booked past their hours', () => {
    for (const t of s.technicians) {
      for (const day of [DATE, addDays(DATE, 1)]) {
        const minutes = s.assignments
          .filter((a) => a.technicianId === t.id && byId.get(a.jobId)!.scheduledDate === day)
          .reduce((sum, a) => sum + byId.get(a.jobId)!.durationMinutes!, 0);
        expect(minutes, `${t.id} ${day}`).toBeLessThanOrEqual(t.maxMinutesDay - 120);
      }
    }
  });

  it('starts each day after clock-in plus the drive from home', () => {
    for (const t of s.technicians) {
      const first = s.assignments
        .filter((a) => a.technicianId === t.id && byId.get(a.jobId)!.scheduledDate === DATE)
        .sort((a, b) => Date.parse(a.windowStart!) - Date.parse(b.windowStart!))[0];
      if (!first) continue;
      const site = s.sites.find((x) => x.id === byId.get(first.jobId)!.siteId)!;
      const drive = scenarioDriveMinutes(t.currentCluster as never, site.estateCluster as never);
      const clockIn = Date.parse(`${DATE}T07:45:00+08:00`);
      expect(Date.parse(first.windowStart!) - clockIn, t.id).toBeGreaterThanOrEqual(drive * 60000);
    }
  });
});

describe('finals scenario: the demo stories hold', () => {
  const raffles = s.jobs.find((j) => j.id === 'job_raffles')!;

  it('Raffles Place is urgent, unassigned, and only Siti and Jonah can legally take it', () => {
    expect(raffles.priority).toBe('urgent');
    expect(s.assignments.some((a) => a.jobId === 'job_raffles')).toBe(false);
    const eligible = stageA(raffles, s.technicians, s.certs, s.shifts, s.jobRequirements)
      .filter((e) => e.isEligible)
      .map((e) => e.technician.id)
      .sort();
    expect(eligible).toEqual(['tech_jonah', 'tech_siti']);
  });

  it('keeps the certificate stories: Marcus lacks the part, Ben and Wei hold lapsed R32', () => {
    const verdicts = stageA(raffles, s.technicians, s.certs, s.shifts, s.jobRequirements);
    expect(verdicts.find((v) => v.technician.id === 'tech_marcus')!.exclusionReasons).toEqual(['missing_parts']);
    const topup = s.jobs.find((j) => j.jobTypeId === 'GAS_TOPUP' && j.scheduledDate === DATE)!;
    const forTopup = stageA(topup, s.technicians, s.certs, s.shifts, s.jobRequirements);
    expect(forTopup.find((v) => v.technician.id === 'tech_ben')!.exclusionReasons).toContain('cert_expired');
    expect(forTopup.find((v) => v.technician.id === 'tech_wei')!.exclusionReasons).toEqual(
      expect.arrayContaining(['tier_too_low', 'cert_expired']),
    );
  });

  it('Hafiz is on site from 08:00 with his next job at 11:00, and Northpoint is promised', () => {
    const hafiz1 = s.jobs.find((j) => j.id === 'job_hafiz_1')!;
    expect(hafiz1.lockState).toBe('in_progress');
    expect(hafiz1.status).toBe('on_site');
    const next = s.assignments.find((a) => a.jobId === 'job_hafiz_2')!;
    expect(next.windowStart).toBe(`${DATE}T11:00:00+08:00`);
    expect(s.jobs.find((j) => j.id === 'job_mei_sla')!.lockState).toBe('promised');
  });
});
