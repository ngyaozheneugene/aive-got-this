import { describe, expect, it } from 'vitest';
import { EASTWIND_DATE } from '../shared/config/demo';
import { EASTWIND } from '../shared/fixtures/eastwind';
import type { BoardSchedule, CandidatePlan } from '../shared/types/domain';
import { validatePlan } from './validate';

describe('Hard-Constraint Plan Validator', () => {
  const mockSchedule: BoardSchedule = {
    date: EASTWIND_DATE,
    snapshotId: 'snap_v1',
    snapshotVersion: 1,
    technicians: EASTWIND.technicians,
    jobs: EASTWIND.jobs,
    assignments: EASTWIND.assignments,
    travel: EASTWIND.travel,
  };

  const validPlan: CandidatePlan = {
    id: 'plan_valid',
    proposalId: 'prop_1',
    sourceSnapshotId: 'snap_v1',
    profile: 'sla_first',
    assignments: [
      {
        jobId: 'job_hafiz_1', // In-progress job assigned to Hafiz
        technicianId: 'tech_hafiz',
        windowStart: `${EASTWIND_DATE}T08:30:00+08:00`,
        windowEnd: `${EASTWIND_DATE}T09:30:00+08:00`,
      },
      {
        jobId: 'job_urgent_test',
        technicianId: 'tech_siti',
        windowStart: `${EASTWIND_DATE}T10:00:00+08:00`,
        windowEnd: `${EASTWIND_DATE}T11:30:00+08:00`,
      },
    ],
    changeSet: [],
    metrics: {
      slaLatenessMinutes: 0,
      travelMinutes: 20,
      overtimeMinutes: 0,
      jobsMoved: 0,
      customersAffected: 1,
      unassignedCount: 0,
    },
    validations: { ok: true, violations: [] },
    solverTrace: {},
    timedOut: false,
    status: 'VALIDATED',
    createdAt: `${EASTWIND_DATE}T08:00:00+08:00`,
  };

  it('should validate a compliant candidate plan with no violations', () => {
    const result = validatePlan(validPlan, mockSchedule);
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('should fail validation when a technician has overlapping job slots', () => {
    const overlappingPlan: CandidatePlan = {
      ...validPlan,
      assignments: [
        {
          jobId: 'job_1',
          technicianId: 'tech_siti',
          windowStart: `${EASTWIND_DATE}T09:00:00+08:00`,
          windowEnd: `${EASTWIND_DATE}T10:30:00+08:00`,
        },
        {
          jobId: 'job_2',
          technicianId: 'tech_siti',
          windowStart: `${EASTWIND_DATE}T10:00:00+08:00`, // Overlaps with job_1
          windowEnd: `${EASTWIND_DATE}T11:30:00+08:00`,
        },
      ],
    };

    const result = validatePlan(overlappingPlan, mockSchedule);
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain('OVERLAP:tech=tech_siti');
  });

  it('should fail validation when an in-progress job is reassigned to a different technician', () => {
    const movedInboundPlan: CandidatePlan = {
      ...validPlan,
      assignments: [
        {
          jobId: 'job_hafiz_1', // In-progress job originally assigned to Hafiz
          technicianId: 'tech_kumar', // Reassigned illegally to Kumar
          windowStart: `${EASTWIND_DATE}T08:30:00+08:00`,
          windowEnd: `${EASTWIND_DATE}T09:30:00+08:00`,
        },
      ],
    };

    const result = validatePlan(movedInboundPlan, mockSchedule);
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toBe('IN_PROGRESS_MOVED:job_hafiz_1');
  });

  it('should fail validation when duplicate assignments exist for the same job', () => {
    const duplicatePlan: CandidatePlan = {
      ...validPlan,
      assignments: [
        {
          jobId: 'job_1',
          technicianId: 'tech_siti',
          windowStart: `${EASTWIND_DATE}T09:00:00+08:00`,
          windowEnd: `${EASTWIND_DATE}T10:00:00+08:00`,
        },
        {
          jobId: 'job_1', // Duplicate assignment
          technicianId: 'tech_kumar',
          windowStart: `${EASTWIND_DATE}T11:00:00+08:00`,
          windowEnd: `${EASTWIND_DATE}T12:00:00+08:00`,
        },
      ],
    };

    const result = validatePlan(duplicatePlan, mockSchedule);
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toBe('DUPLICATE_ASSIGNMENT:job_1');
  });
});
