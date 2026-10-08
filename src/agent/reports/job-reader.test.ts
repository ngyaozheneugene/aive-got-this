import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseStandardJobsCsv,
  parseJobsHeuristically,
  readJobs,
  readJobsFromParquet,
} from './job-reader';
import { parseCsvRows } from './roster-reader';

describe('Job Reader', () => {
  const perfectCsv = fs.readFileSync(
    path.resolve(process.cwd(), 'sample-imports', 'jobs_perfect.csv'),
    'utf-8',
  );
  const messyCsv = fs.readFileSync(
    path.resolve(process.cwd(), 'sample-imports', 'jobs_messy.csv'),
    'utf-8',
  );
  const scrambledCsv = fs.readFileSync(
    path.resolve(process.cwd(), 'sample-imports', 'jobs_scrambled.csv'),
    'utf-8',
  );

  const perfectParquet = fs.readFileSync(
    path.resolve(process.cwd(), 'sample-imports', 'jobs_perfect.parquet'),
  );
  const messyParquet = fs.readFileSync(
    path.resolve(process.cwd(), 'sample-imports', 'jobs_messy.parquet'),
  );
  const scrambledParquet = fs.readFileSync(
    path.resolve(process.cwd(), 'sample-imports', 'jobs_scrambled.parquet'),
  );

  it('parses standard template jobs CSV with fast path', async () => {
    const result = await readJobs(perfectCsv);
    expect(result.source).toBe('template_fast_path');
    expect(result.candidates.length).toBe(5);
    expect(result.validCount).toBe(5);

    const raffles = result.candidates[0]!;
    expect(raffles.customerName).toBe('Raffles Place Capital');
    expect(raffles.phone).toBe('91234567');
    expect(raffles.postalCode).toBe('048616');
    expect(raffles.cluster).toBe('CBD');
    expect(raffles.jobTypeId).toBe('WATER_LEAK');
    expect(raffles.priority).toBe('urgent');
    expect(raffles.windowStart).toBe('09:00');
    expect(raffles.windowEnd).toBe('12:00');
    expect(raffles.isValid).toBe(true);

    const tan = result.candidates[1]!;
    expect(tan.customerName).toBe('Tan Household (Simei)');
    expect(tan.postalCode).toBe('520123');
    expect(tan.cluster).toBe('East (Tampines, Pasir Ris, Changi)');
    expect(tan.jobTypeId).toBe('GENERAL_SERVICE');
    expect(tan.priority).toBe('on_demand');
  });

  it('parses messy CRM ticket export format', async () => {
    const candidates = parseJobsHeuristically(messyCsv);
    expect(candidates.length).toBeGreaterThanOrEqual(4);

    const farEast = candidates.find((c) => c.customerName.toLowerCase().includes('far east'));
    expect(farEast).toBeDefined();
    expect(farEast?.phone).toBe('91882345');
    expect(farEast?.postalCode).toBe('307506');
    expect(farEast?.cluster).toContain('Central');
    expect(farEast?.jobTypeId).toBe('WATER_LEAK');
    expect(farEast?.priority).toBe('urgent');

    const uncleTeo = candidates.find((c) => c.customerName.toLowerCase().includes('uncle teo'));
    expect(uncleTeo).toBeDefined();
    expect(uncleTeo?.phone).toBe('82991122');
    expect(uncleTeo?.postalCode).toBe('460218');
    expect(uncleTeo?.cluster).toContain('Bedok');
    expect(uncleTeo?.jobTypeId).toBe('GAS_TOPUP');
  });

  it('handles scrambled CSV tickets and flags invalid rows', async () => {
    const candidates = parseJobsHeuristically(scrambledCsv);
    expect(candidates.length).toBeGreaterThanOrEqual(1);

    const invalid = candidates.filter((c) => !c.isValid);
    expect(invalid.length).toBeGreaterThanOrEqual(1);
    const hasIssues = invalid.some((c) =>
      c.issues.some((i) => i.includes('Postal code') || i.includes('Phone') || i.includes('Time window')),
    );
    expect(hasIssues).toBe(true);
  });

  it('parses standard template jobs Parquet binary with fast path', async () => {
    const result = await readJobsFromParquet(perfectParquet);
    expect(result.source).toBe('template_fast_path');
    expect(result.candidates.length).toBe(5);
    expect(result.validCount).toBe(5);

    const jurong = result.candidates[2]!;
    expect(jurong.customerName).toBe('Jurong Gateway Offices');
    expect(jurong.phone).toBe('83456789');
    expect(jurong.postalCode).toBe('608549');
    expect(jurong.cluster).toBe('West (Jurong, Clementi)');
    expect(jurong.jobTypeId).toBe('CRITICAL_HVAC_ELECTRICAL');
    expect(jurong.priority).toBe('urgent');
    expect(jurong.isValid).toBe(true);
  });

  it('parses messy CRM jobs Parquet binary', async () => {
    const result = await readJobsFromParquet(messyParquet);
    expect(result.candidates.length).toBeGreaterThanOrEqual(4);

    const desmond = result.candidates.find((c) => c.customerName.toLowerCase().includes('desmond'));
    expect(desmond).toBeDefined();
    expect(desmond?.phone).toBe('96554321');
    expect(desmond?.postalCode).toBe('520245');
    expect(desmond?.cluster).toBe('East (Tampines, Pasir Ris, Changi)');
    expect(desmond?.jobTypeId).toBe('GENERAL_SERVICE');
  });

  it('handles scrambled jobs Parquet binary and isolates validation issues', async () => {
    const result = await readJobsFromParquet(scrambledParquet);
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);

    const invalid = result.candidates.filter((c) => !c.isValid);
    expect(invalid.length).toBeGreaterThanOrEqual(1);
  });
});
