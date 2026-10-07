import { describe, expect, it } from 'vitest';
import { createEventBodySchema } from '../../shared/contracts/events';
import { DISRUPTIONS, disruptionForOverrun, disruptionForUnavailable, findDisruption } from './disruptions';

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

describe('disruptions raised from the board', () => {
  const row = {
    job: { id: 'job_kumar_3' },
    customer: { name: 'Jurong Gateway Offices' },
    site: { addressLine1: 'Jurong Gateway Rd' },
    technician: { name: 'Kumar' },
  } as unknown as Parameters<typeof disruptionForOverrun>[0];

  it('sends bodies the platform accepts, for every kind of absence and any overrun', () => {
    const kumar = { id: 'tech_kumar', name: 'Kumar' };
    const bodies = [
      disruptionForUnavailable(kumar, '2026-10-20', { mode: 'day' }).body,
      disruptionForUnavailable(kumar, '2026-10-20', { mode: 'until', time: '14:00' }).body,
      disruptionForUnavailable(kumar, '2026-10-20', { mode: 'from', time: '15:30' }).body,
      disruptionForOverrun(row, 25).body,
    ];
    for (const body of bodies) expect(createEventBodySchema.safeParse(body).success, JSON.stringify(body)).toBe(true);
    expect(bodies[1]).toEqual({ type: 'technician_unavailable', payload: { technicianId: 'tech_kumar', until: '2026-10-20T14:00:00+08:00' } });
  });

  it('rebuilds the same body from the key after a reload', () => {
    const away = disruptionForUnavailable({ id: 'tech_kumar', name: 'Kumar' }, '2026-10-20', { mode: 'from', time: '15:30' });
    const late = disruptionForOverrun(row, 40);
    // A fresh page has none of the names, only the keys in the stored feed.
    expect(findDisruption(away.key).body).toEqual(away.body);
    expect(findDisruption(late.key).body).toEqual(late.body);
    // Keys this page never built, as a reloaded feed holds them.
    expect(findDisruption('off:tech_wei:until:2026-10-20:13:15').body).toEqual({
      type: 'technician_unavailable', payload: { technicianId: 'tech_wei', until: '2026-10-20T13:15:00+08:00' },
    });
    expect(findDisruption('off:tech_wei:day').body).toEqual({ type: 'technician_unavailable', payload: { technicianId: 'tech_wei' } });
    expect(findDisruption('late:job_wei_2:75').body).toEqual({ type: 'job_overrun', payload: { jobId: 'job_wei_2', overrunMinutes: 75 } });
    expect(away.headline).toBe('Kumar is leaving at 15:30');
    expect(late.headline).toBe('Kumar’s job at Jurong Gateway Rd is running 40 min late');
  });
});
