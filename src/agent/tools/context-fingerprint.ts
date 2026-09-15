import { createHash } from 'node:crypto';
import type { PlanningContext } from './urgent';

// Board, certificate, shift, requirement and note arrays are collections here.
// A different database row order must not masquerade as an operational change.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical).sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

/** Invalidate prior candidates if live rows change even without a new snapshot ID. */
export function planningContextFingerprint(context: PlanningContext): string {
  return createHash('sha256').update(JSON.stringify(canonical(context))).digest('hex');
}
