import { describe, expect, it } from 'vitest';
import type { CandidatePlan, DeskBoard, DeskJobRow, PlanMetrics } from '../../shared/types/domain';
import {
  approveReasons, compareToOther, workloadNotes, describeChanges, recommendationReason, refusalCopy, violationCopy,
} from './copy';
import { RETRYABLE_PLANNING_CODES } from './refusals';

const T = (hh: number, mm = 0) => `2026-09-15T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+08:00`;

function row(jobId: string, customer: string, techId?: string, start?: string, end?: string): DeskJobRow {
  return {
    job: { id: jobId, priority: 'normal' },
    customer: { name: customer },
    site: { postalCode: '048616', addressLine1: '' },
    assignment: techId ? { technicianId: techId, windowStart: start, windowEnd: end } : undefined,
  } as unknown as DeskJobRow;
}

const board = {
  date: '2026-09-15',
  snapshot: { version: 1 },
  technicians: [
    { technician: { id: 'tech_siti', name: 'Siti' }, loadMinutes: 135 },
    { technician: { id: 'tech_jonah', name: 'Jonah' }, loadMinutes: 90 },
  ],
  jobs: [row('job_a', 'Tampines Hub', 'tech_siti', T(9), T(10)), row('job_raffles', 'Raffles Place Capital')],
} as unknown as DeskBoard;

function metrics(m: Partial<PlanMetrics>): PlanMetrics {
  return { slaLatenessMinutes: 0, travelMinutes: 0, overtimeMinutes: 0, jobsMoved: 0, customersAffected: 1, unassignedCount: 0, ...m };
}

const sla = {
  id: 'p1',
  profile: 'sla_first',
  metrics: metrics({ travelMinutes: 22 }),
  assignments: [{ jobId: 'job_raffles', technicianId: 'tech_siti', windowStart: T(13), windowEnd: T(14, 30), travelBeforeMinutes: 22 }],
} as unknown as CandidatePlan;

const calm = {
  id: 'p2',
  profile: 'minimal_disruption',
  metrics: metrics({ travelMinutes: 30 }),
  assignments: [{ jobId: 'job_raffles', technicianId: 'tech_jonah', windowStart: T(13), windowEnd: T(14, 30), travelBeforeMinutes: 30 }],
} as unknown as CandidatePlan;

describe('describeChanges', () => {
  it('says who takes which job, when, and the drive', () => {
    expect(describeChanges(board, sla)).toEqual(['Siti takes Raffles Place Capital, 13:00–14:30 · 22 min drive']);
  });

  it('names both technicians when a job moves between them', () => {
    const moved = { ...sla, assignments: [{ jobId: 'job_a', technicianId: 'tech_jonah', windowStart: T(9), windowEnd: T(10) }] } as CandidatePlan;
    expect(describeChanges(board, moved)).toEqual(['Tampines Hub moves from Siti to Jonah, 09:00–10:00']);
  });
});

describe('compareToOther', () => {
  it('lists only the measures that differ, on the right side', () => {
    expect(compareToOther(sla, calm)).toEqual({ better: ['8 min less driving'], worse: [] });
    expect(compareToOther(calm, sla)).toEqual({ better: [], worse: ['8 min more driving'] });
  });

  it('says nothing when the plans cost the same', () => {
    expect(compareToOther(sla, { ...sla, id: 'p3' } as CandidatePlan)).toEqual({ better: [], worse: [] });
  });
});

describe('recommendationReason', () => {
  it('explains the pick from how the backend selected it', () => {
    expect(recommendationReason('requested_profile', sla)).toContain('On-time first');
    expect(recommendationReason('available_validated_plan', sla)).toContain('only option');
    expect(recommendationReason('requested_profile', undefined)).toBeNull();
  });
});

describe('approveReasons', () => {
  it('offers reasons specific to the selected option', () => {
    const reasons = approveReasons(board, sla, [sla, calm]);
    expect(reasons).toContain('8 min less driving than the other option.');
    expect(reasons.some((r) => r.startsWith('Siti takes Raffles Place Capital'))).toBe(true);
  });

  it('offers nothing until an option is selected', () => {
    expect(approveReasons(board, undefined, [sla, calm])).toEqual([]);
  });
});

describe('refusalCopy', () => {
  it('tells the coordinator a retryable failure changed nothing', () => {
    for (const code of RETRYABLE_PLANNING_CODES) expect(refusalCopy(code).detail).toMatch(/Nothing was changed/);
  });

  it('falls back to a safe message for an unknown code', () => {
    expect(refusalCopy('something_new').title).toBe('Something went wrong');
  });
});

describe('violationCopy', () => {
  it('translates validator codes and keeps unknown ones verbatim', () => {
    expect(violationCopy('MISSING_CERT:tech=tech_x:cert=R32')).toBe('Technician isn’t certified for this job');
    expect(violationCopy('NEW_CODE:x')).toBe('NEW_CODE:x');
  });
});

describe('workloadNotes', () => {
  it('shows how busy the technician taking new work already is', () => {
    expect(workloadNotes(board, calm)).toEqual(['Jonah already has 90 min of work booked today']);
  });
});
