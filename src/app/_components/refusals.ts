// Planning refusal handling for the desk. JSX-free so the retry rule is unit
// tested without a DOM (vitest runs in a node environment).
//
// A planning request (POST /api/events/{id}/plan) can be refused with a
// backend-owned code. Every code is surfaced verbatim; only a transient
// dependency failure earns a retry affordance, because re-issuing the same
// request succeeds once the dependency recovers.
//
// The retryable set is exactly the three the task board names for the desk
// (docs/tasks.md, G3): the gateway or a dependency was briefly unavailable or
// ran out of time. The server also flags `scheduler_unavailable` and
// `planning_cancelled` retryable internally, but those are deliberately NOT
// offered a desk retry: `scheduler_unavailable` means "not implemented for this
// flow" (a retry cannot fix it) and a cancellation was the coordinator's own
// action. A retry belongs on exactly these codes and nowhere else.

export interface Refusal {
  code: string;
  detail?: string;
}

export const RETRYABLE_PLANNING_CODES = [
  'gateway_unavailable',
  'planning_timeout',
  'scheduler_timeout',
] as const;

const RETRYABLE = new Set<string>(RETRYABLE_PLANNING_CODES);

export function isRetryablePlanningCode(code: string): boolean {
  return RETRYABLE.has(code);
}
