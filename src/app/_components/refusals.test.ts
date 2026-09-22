import { describe, expect, it } from 'vitest';
import { RETRYABLE_PLANNING_CODES, isRetryablePlanningCode } from './refusals';

describe('isRetryablePlanningCode', () => {
  it('offers a retry on exactly the three transient dependency codes', () => {
    expect([...RETRYABLE_PLANNING_CODES]).toEqual([
      'gateway_unavailable',
      'planning_timeout',
      'scheduler_timeout',
    ]);
    for (const code of RETRYABLE_PLANNING_CODES) {
      expect(isRetryablePlanningCode(code)).toBe(true);
    }
  });

  it('does not offer a retry on non-transient planning refusals', () => {
    // These reach the desk from the plan endpoint but a retry cannot help:
    // the event or board state is what is wrong, or the flow is unsupported.
    const nonRetryable = [
      'planning_in_progress',
      'stale_planning_context',
      'event_not_plannable',
      'proposal_exists',
      'unsupported_event_type',
      'invalid_event_context',
      // Server flags these retryable internally, but the desk must not: a retry
      // cannot implement a missing flow or un-cancel the coordinator's action.
      'scheduler_unavailable',
      'planning_cancelled',
      'planning_failed',
      'agent_failed',
    ];
    for (const code of nonRetryable) {
      expect(isRetryablePlanningCode(code)).toBe(false);
    }
  });
});
