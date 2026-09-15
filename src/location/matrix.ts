import { EASTWIND } from '../shared/fixtures/eastwind';
import type { TravelMatrix } from '../shared/types/domain';

/**
 * Calculates travel duration in minutes between two Singapore estate clusters using a travel matrix.
 * Case-insensitive for cluster names. Supports peak-hour travel times.
 */
export function travelMinutes(
  fromCluster: string,
  toCluster: string,
  matrix: TravelMatrix[] = EASTWIND.travel,
  peak = false,
): number {
  const fromNorm = fromCluster.trim().toLowerCase();
  const toNorm = toCluster.trim().toLowerCase();

  const hit = matrix.find(
    (row) =>
      row.fromCluster.trim().toLowerCase() === fromNorm &&
      row.toCluster.trim().toLowerCase() === toNorm,
  );

  if (!hit) {
    throw new Error(`TRAVEL_MATRIX_MISSING:${fromCluster}->${toCluster}`);
  }

  return peak ? hit.peakMinutes : hit.minutes;
}

/**
 * Helper to determine if an ISO timestamp falls within peak Singapore traffic hours.
 * Peak windows: 08:00 - 09:30 and 17:00 - 19:30.
 */
export function isPeakHour(isoTimestamp: string): boolean {
  const date = new Date(isoTimestamp);
  const hour = date.getHours();
  const minute = date.getMinutes();
  const totalMinutes = hour * 60 + minute;

  // Morning peak: 8:00 (480) to 9:30 (570)
  const isMorningPeak = totalMinutes >= 480 && totalMinutes <= 570;
  // Evening peak: 17:00 (1020) to 19:30 (1170)
  const isEveningPeak = totalMinutes >= 1020 && totalMinutes <= 1170;

  return isMorningPeak || isEveningPeak;
}
