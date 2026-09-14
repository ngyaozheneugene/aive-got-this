import { describe, expect, it } from 'vitest';
import { EASTWIND_DATE } from '../../src/shared/config/demo';
import { EASTWIND } from '../../src/shared/fixtures/eastwind';
import type { BoardSchedule, OperationalEvent } from '../../src/shared/types/domain';
import { propose } from '../../src/matching/propose';
import { stageA } from '../../src/matching/gates/stage-a';

describe('G-01: Nearest unqualified technician exclusion (Raffles Place leak)', () => {
  const schedule: BoardSchedule = {
    date: EASTWIND_DATE,
    snapshotId: 'snap_v1',
    snapshotVersion: 1,
    technicians: EASTWIND.technicians,
    jobs: EASTWIND.jobs,
    assignments: EASTWIND.assignments,
    travel: EASTWIND.travel,
  };

  const rafflesJob = EASTWIND.jobs.find((j) => j.id === 'job_raffles')!;

  it('excludes Wei (tech_wei) from Stage A eligibility due to expired NEA_R32 cert and low tier', () => {
    const results = stageA(
      rafflesJob,
      EASTWIND.technicians,
      EASTWIND.certs,
      EASTWIND.shifts,
      EASTWIND.jobRequirements,
    );

    const wei = results.find((r) => r.technician.id === 'tech_wei');
    expect(wei).toBeDefined();
    expect(wei?.isEligible).toBe(false);
    expect(wei?.exclusionReasons).toContain('cert_expired');
    expect(wei?.exclusionReasons).toContain('tier_too_low');
  });

  it('never assigns Wei (nearest van in CBD) when running propose() for Raffles Place urgent job', () => {
    const event: OperationalEvent = {
      id: 'evt_g01',
      type: 'urgent_job',
      rawText: 'Urgent leak at Raffles Place',
      normalizedPayload: { jobId: 'job_raffles' },
      sourceSnapshotId: 'snap_v1',
      affectedIds: ['job_raffles'],
      validationIssues: [],
      status: 'VALIDATED',
      receivedAt: `${EASTWIND_DATE}T08:30:00+08:00`,
    };

    const out = propose({ event, schedule, profile: 'sla_first' });
    expect(out.plans.length).toBeGreaterThan(0);

    for (const plan of out.plans) {
      const slot = plan.assignments.find((a) => a.jobId === 'job_raffles');
      expect(slot).toBeDefined();
      expect(slot?.technicianId).not.toBe('tech_wei');
    }
  });
});
