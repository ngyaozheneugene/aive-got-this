import type { TravelMatrix } from '../shared/types/domain';

export function travelMinutes(
  fromCluster: string,
  toCluster: string,
  matrix: TravelMatrix[],
  peak = false,
): number {
  const hit = matrix.find((row) => row.fromCluster === fromCluster && row.toCluster === toCluster);
  if (!hit) {
    throw new Error(`TRAVEL_MATRIX_MISSING:${fromCluster}->${toCluster}`);
  }
  return peak ? hit.peakMinutes : hit.minutes;
}
