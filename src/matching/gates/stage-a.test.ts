import { describe, expect, it } from 'vitest';
import { EASTWIND_DATE } from '../../shared/config/demo';
import { EASTWIND } from '../../shared/fixtures/eastwind';
import type { Job, JobRequirement, Shift, Technician } from '../../shared/types/domain';
import { stageA } from './stage-a';

describe('Stage A Eligibility Gates', () => {
  it('should mark Wei as ineligible due to tier and expired NEA_R32 cert for urgent job requiring tier 2 and active NEA_R32', () => {
    const urgentJob: Job = {
      id: 'job_urgent_test',
      customerId: 'cust_raffles',
      siteId: 'site_raffles',
      jobTypeId: 'jt_leak',
      status: 'unassigned',
      priority: 'urgent',
      windowType: 'tight',
      lockState: 'none',
      scheduledDate: EASTWIND_DATE,
      windowStart: `${EASTWIND_DATE}T09:00:00+08:00`,
      windowEnd: `${EASTWIND_DATE}T11:00:00+08:00`,
      durationMinutes: 90,
      partsRequired: [],
      toolsRequired: [],
      noteRaw: 'Raffles Place urgent leak',
      requiredCrewSize: 1,
      boardVersionAtRank: 1,
      confidenceScore: 1.0,
      createdAt: `${EASTWIND_DATE}T08:00:00+08:00`,
      updatedAt: `${EASTWIND_DATE}T08:00:00+08:00`,
    };

    const requirement: JobRequirement = {
      id: 'req_urgent_test',
      jobId: 'job_urgent_test',
      minTier: 2,
      requiredCerts: ['NEA_R32'],
      requiredCrewSize: 1,
      createdAt: `${EASTWIND_DATE}T08:00:00+08:00`,
    };

    const results = stageA(
      urgentJob,
      EASTWIND.technicians,
      EASTWIND.certs,
      EASTWIND.shifts,
      [requirement],
    );

    const weiResult = results.find((r) => r.technician.id === 'tech_wei');
    expect(weiResult).toBeDefined();
    expect(weiResult?.isEligible).toBe(false);
    expect(weiResult?.exclusionReasons).toContain('tier_too_low');
    expect(weiResult?.exclusionReasons).toContain('cert_expired');

    const sitiResult = results.find((r) => r.technician.id === 'tech_siti');
    expect(sitiResult).toBeDefined();
    expect(sitiResult?.isEligible).toBe(true);
    expect(sitiResult?.exclusionReasons).toHaveLength(0);
  });

  it('should mark technician on MC as ineligible', () => {
    const job: Job = {
      id: 'job_test_2',
      customerId: 'cust_1',
      siteId: 'site_1',
      jobTypeId: 'jt_servicing',
      status: 'unassigned',
      priority: 'on_demand',
      windowType: 'loose',
      scheduledDate: EASTWIND_DATE,
      requiredCrewSize: 1,
      boardVersionAtRank: 1,
      confidenceScore: 1.0,
      noteRaw: '',
      createdAt: `${EASTWIND_DATE}T08:00:00+08:00`,
      updatedAt: `${EASTWIND_DATE}T08:00:00+08:00`,
    };

    const techOnMc: Technician = {
      id: 'tech_mc',
      name: 'Tech MC',
      tier: 2,
      homeRegion: 'Central',
      maxMinutesDay: 480,
      acceptsOt: false,
      isActive: true,
      createdAt: `${EASTWIND_DATE}T00:00:00+08:00`,
    };

    const mcShift: Shift = {
      id: 'shift_mc',
      technicianId: 'tech_mc',
      shiftDate: EASTWIND_DATE,
      status: 'mc',
      createdAt: `${EASTWIND_DATE}T00:00:00+08:00`,
    };

    const results = stageA(job, [techOnMc], [], [mcShift], []);
    expect(results[0]?.isEligible).toBe(false);
    expect(results[0]?.exclusionReasons).toContain('on_leave_or_mc');
  });

  it('should mark technician with missing cert as ineligible', () => {
    const job: Job = {
      id: 'job_test_3',
      customerId: 'cust_1',
      siteId: 'site_1',
      jobTypeId: 'jt_electrical',
      status: 'unassigned',
      priority: 'on_demand',
      windowType: 'loose',
      scheduledDate: EASTWIND_DATE,
      requiredCrewSize: 1,
      boardVersionAtRank: 1,
      confidenceScore: 1.0,
      noteRaw: '',
      createdAt: `${EASTWIND_DATE}T08:00:00+08:00`,
      updatedAt: `${EASTWIND_DATE}T08:00:00+08:00`,
    };

    const requirement: JobRequirement = {
      id: 'req_elec',
      jobId: 'job_test_3',
      minTier: 1,
      requiredCerts: ['EMA_LEW'],
      requiredCrewSize: 1,
      createdAt: `${EASTWIND_DATE}T08:00:00+08:00`,
    };

    const techNoLew: Technician = {
      id: 'tech_normal',
      name: 'Normal Tech',
      tier: 2,
      homeRegion: 'Central',
      maxMinutesDay: 480,
      acceptsOt: false,
      isActive: true,
      createdAt: `${EASTWIND_DATE}T00:00:00+08:00`,
    };

    const normalShift: Shift = {
      id: 'shift_norm',
      technicianId: 'tech_normal',
      shiftDate: EASTWIND_DATE,
      status: 'clocked_in',
      createdAt: `${EASTWIND_DATE}T00:00:00+08:00`,
    };

    const results = stageA(job, [techNoLew], [], [normalShift], [requirement]);
    expect(results[0]?.isEligible).toBe(false);
    expect(results[0]?.exclusionReasons).toContain('missing_cert');
  });
});
