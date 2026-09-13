import { describe, expect, it } from 'vitest';
import { EASTWIND } from '../../src/shared/fixtures/eastwind';
import { travelMinutes } from '../../src/location/matrix';
import { propose } from '../../src/matching/propose';

describe('G0 contracts on the Eastwind fixture', () => {
  it('has the demo day shape', () => {
    expect(EASTWIND.technicians).toHaveLength(6);
    expect(EASTWIND.jobs).toHaveLength(12);
    expect(EASTWIND.jobs.some((j) => j.id === 'job_raffles' && j.status === 'unassigned')).toBe(true);
  });

  it('uses the fixture matrix, not a silent 20-minute default', () => {
    expect(travelMinutes('cbd', 'east', EASTWIND.travel)).toBe(22);
    expect(() => travelMinutes('cbd', 'mars', EASTWIND.travel)).toThrow(/TRAVEL_MATRIX_MISSING/);
  });

  it('exports propose() with an empty insertion stub', () => {
    const out = propose({
      event: {
        id: 'opev_test',
        type: 'urgent_job',
        rawText: '',
        normalizedPayload: { jobId: 'job_raffles' },
        affectedIds: ['job_raffles'],
        validationIssues: [],
        status: 'VALIDATED',
        receivedAt: EASTWIND.date,
      },
      schedule: {
        date: EASTWIND.date,
        snapshotId: EASTWIND.snapshot.id,
        snapshotVersion: 1,
        technicians: EASTWIND.technicians,
        jobs: EASTWIND.jobs,
        assignments: EASTWIND.assignments,
        travel: EASTWIND.travel,
      },
      profile: 'sla_first',
    });
    expect(out.engine).toBe('insertion');
    expect(out.plans).toEqual([]);
  });
});
