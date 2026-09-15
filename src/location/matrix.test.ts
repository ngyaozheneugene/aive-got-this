import { describe, expect, it } from 'vitest';
import { EASTWIND_DATE } from '../shared/config/demo';
import { EASTWIND } from '../shared/fixtures/eastwind';
import { isPeakHour, travelMinutes } from './matrix';

describe('Location & Travel Matrix Engine', () => {
  it('should calculate off-peak intra-cluster travel duration (8 mins)', () => {
    const minutes = travelMinutes('cbd', 'cbd', EASTWIND.travel, false);
    expect(minutes).toBe(8);
  });

  it('should calculate peak intra-cluster travel duration (12 mins)', () => {
    const minutes = travelMinutes('cbd', 'cbd', EASTWIND.travel, true);
    expect(minutes).toBe(12);
  });

  it('should calculate inter-cluster travel duration between CBD and East (22 off-peak / 34 peak)', () => {
    const offPeak = travelMinutes('cbd', 'east', EASTWIND.travel, false);
    const peak = travelMinutes('cbd', 'east', EASTWIND.travel, true);
    expect(offPeak).toBe(22);
    expect(peak).toBe(34);
  });

  it('should perform case-insensitive cluster lookups (e.g. CBD -> East)', () => {
    const minutes = travelMinutes('CBD', 'East', EASTWIND.travel, false);
    expect(minutes).toBe(22);
  });

  it('should default to EASTWIND travel matrix when matrix parameter is omitted', () => {
    const minutes = travelMinutes('cbd', 'east');
    expect(minutes).toBe(22);
  });

  it('should throw TRAVEL_MATRIX_MISSING for unknown cluster pairs', () => {
    expect(() => travelMinutes('unknown_1', 'unknown_2', EASTWIND.travel)).toThrow(
      'TRAVEL_MATRIX_MISSING:unknown_1->unknown_2',
    );
  });

  it('should identify peak traffic hours correctly', () => {
    expect(isPeakHour(`${EASTWIND_DATE}T08:30:00+08:00`)).toBe(true);
    expect(isPeakHour(`${EASTWIND_DATE}T18:00:00+08:00`)).toBe(true);
    expect(isPeakHour(`${EASTWIND_DATE}T14:00:00+08:00`)).toBe(false);
  });
});
