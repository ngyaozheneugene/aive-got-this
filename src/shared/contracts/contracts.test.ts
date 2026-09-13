import { describe, expect, it } from 'vitest';
import { createEventBodySchema, proposeOutputSchema } from './index';

describe('G0 contracts', () => {
  it('accepts an urgent_job event body', () => {
    const parsed = createEventBodySchema.parse({
      type: 'urgent_job',
      payload: { jobId: 'job_raffles' },
    });
    expect(parsed.type).toBe('urgent_job');
    if (parsed.type === 'urgent_job') {
      expect(parsed.payload.jobId).toBe('job_raffles');
    }
  });

  it('rejects an unknown event type', () => {
    expect(() =>
      createEventBodySchema.parse({ type: 'cancellation', payload: {} }),
    ).toThrow();
  });

  it('accepts an empty insertion propose() result', () => {
    const parsed = proposeOutputSchema.parse({
      plans: [],
      engine: 'insertion',
      timedOut: false,
      message: 'not_implemented',
    });
    expect(parsed.plans).toHaveLength(0);
  });
});
