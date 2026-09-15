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
 *
 * Reads the wall-clock time written in the timestamp itself. `Date.getHours()`
 * returns the *host machine's* local hour, so this answered correctly only on a
 * machine set to Asia/Singapore: it passed on our laptops and returned false for
 * every peak hour on CI and on the Lightsail box, both of which run UTC.
 *
 * Product times are ISO 8601 with an explicit +08:00 offset (plan section 7.1),
 * so the HH:MM in the string is already Singapore local time.
 */
export function isPeakHour(isoTimestamp: string): boolean {
  const clock = /T(\d{2}):(\d{2})/.exec(isoTimestamp);
  if (!clock) return false;

  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  const totalMinutes = hour * 60 + minute;

  // Morning peak: 8:00 (480) to 9:30 (570)
  const isMorningPeak = totalMinutes >= 480 && totalMinutes <= 570;
  // Evening peak: 17:00 (1020) to 19:30 (1170)
  const isEveningPeak = totalMinutes >= 1020 && totalMinutes <= 1170;

  return isMorningPeak || isEveningPeak;
}
