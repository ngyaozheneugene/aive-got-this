import { describe, expect, it } from 'vitest';
import { EASTWIND_DATE } from '../../src/shared/config/demo';
import { stageA } from '../../src/matching/gates/stage-a';
import type { Job, JobRequirement, Shift, Technician, TechnicianCert } from '../../src/shared/types/domain';

describe('G-03: Legal certificate expiration gate enforcement', () => {
  const mockTech: Technician = {
    id: 'tech_legal_test',
    name: 'Legal Test Tech',
    tier: 3,
    homeRegion: 'Central',
    maxMinutesDay: 480,
    acceptsOt: false,
    isActive: true,
    createdAt: `${EASTWIND_DATE}T00:00:00+08:00`,
  };

  const mockShift: Shift = {
    id: 'shift_legal_test',
    technicianId: 'tech_legal_test',
    shiftDate: EASTWIND_DATE,
    status: 'clocked_in',
    createdAt: `${EASTWIND_DATE}T00:00:00+08:00`,
  };

  const mockJob: Job = {
    id: 'job_legal_test',
    customerId: 'cust_1',
    siteId: 'site_1',
    jobTypeId: 'jt_leak',
    status: 'unassigned',
    priority: 'urgent',
    windowType: 'tight',
    scheduledDate: EASTWIND_DATE,
    requiredCrewSize: 1,
    boardVersionAtRank: 1,
    confidenceScore: 1.0,
    noteRaw: '',
    createdAt: `${EASTWIND_DATE}T08:00:00+08:00`,
    updatedAt: `${EASTWIND_DATE}T08:00:00+08:00`,
  };

  const mockReq: JobRequirement = {
    id: 'req_legal_test',
    jobId: 'job_legal_test',
    minTier: 2,
    requiredCerts: ['BCA_STRUCTURAL'],
    requiredCrewSize: 1,
    createdAt: `${EASTWIND_DATE}T08:00:00+08:00`,
  };

  it('excludes technician when BCA_STRUCTURAL certificate is expired on job date', () => {
    const expiredCert: TechnicianCert = {
      id: 'cert_expired_bca',
      technicianId: 'tech_legal_test',
      certType: 'BCA_STRUCTURAL',
      issuedAt: '2023-01-01',
      expiresAt: '2025-12-31', // Expired before EASTWIND_DATE (2026-09-15)
      isLegalGate: true,
      createdAt: '2023-01-01T00:00:00+08:00',
    };

    const results = stageA(mockJob, [mockTech], [expiredCert], [mockShift], [mockReq]);
    expect(results[0]?.isEligible).toBe(false);
    expect(results[0]?.exclusionReasons).toContain('cert_expired');
  });

  it('allows technician when BCA_STRUCTURAL certificate is valid and unexpired', () => {
    const validCert: TechnicianCert = {
      id: 'cert_valid_bca',
      technicianId: 'tech_legal_test',
      certType: 'BCA_STRUCTURAL',
      issuedAt: '2024-01-01',
      expiresAt: '2027-12-31',
      isLegalGate: true,
      createdAt: '2024-01-01T00:00:00+08:00',
    };

    const results = stageA(mockJob, [mockTech], [validCert], [mockShift], [mockReq]);
    expect(results[0]?.isEligible).toBe(true);
    expect(results[0]?.exclusionReasons).toHaveLength(0);
  });
});
