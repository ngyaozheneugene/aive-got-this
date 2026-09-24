import { describe, expect, it } from 'vitest';
import { disruptionEventBody } from './desk-api';

describe('disruptionEventBody', () => {
  it('raises the three demo events through the published event contract', () => {
    expect(disruptionEventBody({ kind: 'urgent_job', profile: 'sla_first' }, 'snap_1')).toEqual({
      type: 'urgent_job',
      payload: { jobId: 'job_raffles' },
      sourceSnapshotId: 'snap_1',
    });
    expect(disruptionEventBody({ kind: 'technician_unavailable', profile: 'sla_first' })).toEqual({
      type: 'technician_unavailable',
      payload: { technicianId: 'tech_hafiz' },
    });
    expect(disruptionEventBody({ kind: 'job_overrun', profile: 'minimal_disruption' })).toEqual({
      type: 'job_overrun',
      payload: { jobId: 'job_hafiz_1', overrunMinutes: 90 },
    });
  });
});
