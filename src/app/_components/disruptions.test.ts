import { describe, expect, it } from 'vitest';
import { createEventBodySchema } from '../../shared/contracts/events';
import { DISRUPTIONS } from './disruptions';

describe('DISRUPTIONS', () => {
  it('exposes the three demo disruptions in order', () => {
    expect(DISRUPTIONS.map((d) => d.body.type)).toEqual([
      'urgent_job',
      'technician_unavailable',
      'job_overrun',
    ]);
  });

  it('every disruption body is valid against the event contract', () => {
    // Guards against a payload typo or drift from createEventBodySchema: the
    // desk must send exactly what the platform accepts.
    for (const d of DISRUPTIONS) {
      const result = createEventBodySchema.safeParse(d.body);
      expect(result.success, `${d.key} body invalid`).toBe(true);
    }
  });
});
