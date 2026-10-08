import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseCsvRows,
  parseStandardCsv,
  parseRosterHeuristically,
  readRoster,
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
});
