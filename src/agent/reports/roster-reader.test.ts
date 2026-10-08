import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseCsvRows,
  parseStandardCsv,
  parseRosterHeuristically,
  readRoster,
  readRosterFromParquet,
} from './roster-reader';

describe('Roster Reader', () => {
  const perfectCsv = fs.readFileSync(
    path.resolve(process.cwd(), 'sample-imports', 'technicians_perfect.csv'),
    'utf-8',
  );
  const messyCsv = fs.readFileSync(
    path.resolve(process.cwd(), 'sample-imports', 'technicians_messy.csv'),
    'utf-8',
  );
  const diagonalCsv = fs.readFileSync(
    path.resolve(process.cwd(), 'sample-imports', 'technicians_diagonal.csv'),
    'utf-8',
  );

  const perfectParquet = fs.readFileSync(
    path.resolve(process.cwd(), 'sample-imports', 'technicians_perfect.parquet'),
  );
  const messyParquet = fs.readFileSync(
    path.resolve(process.cwd(), 'sample-imports', 'technicians_messy.parquet'),
  );
  const scrambledParquet = fs.readFileSync(
    path.resolve(process.cwd(), 'sample-imports', 'technicians_scrambled.parquet'),
  );

  it('parses standard template CSV with fast path', async () => {
    const result = await readRoster(perfectCsv);
    expect(result.source).toBe('template_fast_path');
    expect(result.candidates.length).toBe(5);
    expect(result.validCount).toBe(5);

    const wei = result.candidates[0]!;
    expect(wei.name).toBe('Tan Wei');
    expect(wei.tier).toBe(1);
    expect(wei.homePostalCode).toBe('048581');
    expect(wei.cluster).toBe('CBD');
    expect(wei.certs).toEqual([{ type: 'WSH_PASS' }]);
    expect(wei.isValid).toBe(true);

    const siti = result.candidates[1]!;
    expect(siti.name).toBe('Siti binti Ahmad');
    expect(siti.tier).toBe(3);
    expect(siti.certs.length).toBe(2);
    expect(siti.parts).toContain('inverter_board');
    expect(siti.acceptsOt).toBe(true);
  });

  it('parses messy SME roster format', async () => {
    const candidates = parseRosterHeuristically(messyCsv);
    expect(candidates.length).toBeGreaterThanOrEqual(4);

    const ahSeng = candidates.find((c) => c.name.toLowerCase().includes('seng'));
    expect(ahSeng).toBeDefined();
    expect(ahSeng?.homePostalCode).toBe('640512');
    expect(ahSeng?.cluster).toBe('West (Jurong, Clementi)');
    expect(ahSeng?.tier).toBe(3);
    expect(ahSeng?.acceptsOt).toBe(true);
    expect(ahSeng?.parts).toContain('inverter_board');
    expect(ahSeng?.certs.some((c) => c.type === 'NEA_R32')).toBe(true);
  });

  it('parses diagonally staggered CSV layout', async () => {
    const candidates = parseRosterHeuristically(diagonalCsv);
    expect(candidates.length).toBeGreaterThanOrEqual(3);

    const siti = candidates.find((c) => c.name.toLowerCase().includes('siti'));
    expect(siti).toBeDefined();
    expect(siti?.tier).toBe(3);
    expect(siti?.homePostalCode).toBe('520112');
    expect(siti?.cluster).toBe('East (Tampines, Pasir Ris, Changi)');
    expect(siti?.certs.some((c) => c.type === 'NEA_R32')).toBe(true);
    expect(siti?.parts).toContain('inverter_board');
    expect(siti?.acceptsOt).toBe(true);
  });

  it('parses standard template Parquet binary with fast path', async () => {
    const result = await readRosterFromParquet(perfectParquet);
    expect(result.source).toBe('template_fast_path');
    expect(result.candidates.length).toBe(5);
    expect(result.validCount).toBe(5);

    const wei = result.candidates[0]!;
    expect(wei.name).toBe('Tan Wei');
    expect(wei.tier).toBe(1);
    expect(wei.homePostalCode).toBe('048581');
    expect(wei.cluster).toBe('CBD');
    expect(wei.certs).toEqual([{ type: 'WSH_PASS' }]);
    expect(wei.isValid).toBe(true);

    const kumar = result.candidates[2]!;
    expect(kumar.name).toBe('Kumar Rajan');
    expect(kumar.tier).toBe(3);
    expect(kumar.homePostalCode).toBe('640605');
    expect(kumar.cluster).toBe('West (Jurong, Clementi)');
    expect(kumar.certs.length).toBe(2);
    expect(kumar.parts).toContain('copper_pipe');
    expect(kumar.parts).toContain('capacitor');
    expect(kumar.maxMinutesDay).toBe(540); // 9 hours
    expect(kumar.acceptsOt).toBe(true);
  });

  it('parses messy HR Parquet format', async () => {
    const result = await readRosterFromParquet(messyParquet);
    expect(result.candidates.length).toBeGreaterThanOrEqual(4);

    const ahSeng = result.candidates.find((c) => c.name.toLowerCase().includes('seng'));
    expect(ahSeng).toBeDefined();
    expect(ahSeng?.homePostalCode).toBe('640512');
    expect(ahSeng?.cluster).toBe('West (Jurong, Clementi)');
    expect(ahSeng?.tier).toBe(3);
    expect(ahSeng?.acceptsOt).toBe(true);
    expect(ahSeng?.parts).toContain('inverter_board');
    expect(ahSeng?.certs.some((c) => c.type === 'NEA_R32')).toBe(true);
  });

  it('handles scrambled Parquet format and isolates validation issues', async () => {
    const result = await readRosterFromParquet(scrambledParquet);
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);

    // Should detect invalid postal codes (e.g., 999999 or 000000) or missing clusters
    const invalidRows = result.candidates.filter((c) => !c.isValid);
    expect(invalidRows.length).toBeGreaterThanOrEqual(1);
    const hasPostalIssue = invalidRows.some((c) =>
      c.issues.some((issue) => issue.includes('Singapore sector') || issue.includes('Postal code')),
    );
    expect(hasPostalIssue).toBe(true);
  });
});
