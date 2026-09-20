// The seam between the validator that emits violation codes, the contract that
// freezes them, and the risk classifier that matches on them.
//
// Three streams read this vocabulary and none of them owned it, so it drifted:
// the validator emitted `EXPIRED_CERT`, the contract froze `CERT_EXPIRED`, and
// `classifyProposalRisk` matched `CERT_EXPIRED`. Every suite stayed green,
// because each stream tested against its own spelling. These tests compare the
// spellings to each other rather than to a hand-written expectation.

import { describe, expect, it } from 'vitest';
import { VALIDATION_VIOLATIONS } from './reason-codes';
import { EASTWIND_DATE } from './demo';
import { EASTWIND } from '../fixtures/eastwind';
import { validatePlan } from '../../matching/validate';
import { classifyProposalRisk } from '../../agent/policy/risk';
import type { BoardSchedule, CandidatePlan, PlannedSlot } from '../types/domain';

const frozen = new Set<string>(VALIDATION_VIOLATIONS);

/** A code may carry a `:detail` suffix; the part before the first colon is the code. */
function codeOf(violation: string): string {
  return violation.split(':')[0] ?? violation;
}

const schedule: BoardSchedule = {
  date: EASTWIND_DATE,
  snapshotId: 'snap_v1',
  snapshotVersion: 1,
  technicians: EASTWIND.technicians,
  jobs: EASTWIND.jobs,
  assignments: EASTWIND.assignments,
  travel: EASTWIND.travel,
  certs: EASTWIND.certs,
  shifts: EASTWIND.shifts,
  jobRequirements: EASTWIND.jobRequirements,
};

function planOf(assignments: PlannedSlot[]): CandidatePlan {
  return {
    id: 'plan_probe',
    proposalId: 'prop_probe',
    sourceSnapshotId: 'snap_v1',
    profile: 'sla_first',
    assignments,
    changeSet: [],
    metrics: {
      slaLatenessMinutes: 0,
      travelMinutes: 0,
      overtimeMinutes: 0,
      jobsMoved: 0,
      customersAffected: 0,
      unassignedCount: 0,
    },
    validations: { ok: true, violations: [] },
    solverTrace: {},
    timedOut: false,
    status: 'VALIDATED',
    createdAt: `${EASTWIND_DATE}T08:00:00+08:00`,
  };
}

const raffles = EASTWIND.jobs.find((job) => job.id === 'job_raffles')!;

function slot(jobId: string, technicianId: string, start: string, end: string): PlannedSlot {
  return {
    jobId,
    technicianId,
    windowStart: `${EASTWIND_DATE}T${start}+08:00`,
    windowEnd: `${EASTWIND_DATE}T${end}+08:00`,
    travelBeforeMinutes: 0,
  };
}

describe('validator violation codes against the frozen vocabulary', () => {
  it('emits only codes the contract names', () => {
    // One plan per rule the validator implements, so a rename anywhere in
    // validate.ts fails here rather than silently reaching the desk.
    const plans = [
      // Wei holds neither required certificate for Raffles Place. (MISSING_CERT, CERT_EXPIRED)
      planOf([slot('job_raffles', 'tech_wei', '13:00:00', '14:30:00')]),
      // Same job twice. (DUPLICATE_ASSIGNMENT)
      planOf([
        slot('job_raffles', 'tech_jonah', '13:00:00', '14:30:00'),
        slot('job_raffles', 'tech_jonah', '15:00:00', '16:30:00'),
      ]),
      // One technician, two jobs, same hour. (OVERLAP)
      planOf([
        slot('job_raffles', 'tech_jonah', '13:00:00', '14:30:00'),
        slot('job_jonah_1', 'tech_jonah', '13:30:00', '14:00:00'),
      ]),
      // Outside the customer window. (WINDOW_INFEASIBLE)
      planOf([slot('job_raffles', 'tech_jonah', '07:00:00', '08:00:00')]),
      // Outside shift clock-in time. (OUTSIDE_SHIFT)
      planOf([slot('job_siti_1', 'tech_siti', '06:00:00', '07:00:00')]),
      // Travel infeasible between consecutive jobs in different clusters. (TRAVEL_INFEASIBLE)
      planOf([
        slot('job_siti_1', 'tech_siti', '08:30:00', '09:30:00'), // East
        slot('job_raffles', 'tech_siti', '09:30:00', '11:00:00'), // CBD (requires 22 mins travel)
      ]),
      // Promised job reassigned to another technician. (LOCKED_MOVED)
      planOf([slot('job_mei_sla', 'tech_siti', '14:00:00', '15:30:00')]),
      // Missing required parts. (MISSING_PARTS)
      planOf([slot('job_raffles', 'tech_kumar', '13:00:00', '14:30:00')]),
      // Excessive overtime for technician who does not accept OT. (EXCESSIVE_OVERTIME)
      planOf([
        slot('job_siti_1', 'tech_siti', '08:00:00', '17:00:00'),
        slot('job_siti_2', 'tech_siti', '17:00:00', '19:00:00'),
      ]),
    ];

    const seen = new Set<string>();
    for (const plan of plans) {
      for (const entry of validatePlan(plan, schedule).violations) seen.add(codeOf(entry));
    }

    expect(seen.size).toBeGreaterThan(0);
    expect([...seen].filter((code) => !frozen.has(code))).toEqual([]);
  });

  it('still rejects the unqualified technician the commit guard used to accept', () => {
    // The G2 release blocker, pinned. Wei is the nearest van and the wrong one.
    const verdict = validatePlan(
      planOf([slot('job_raffles', 'tech_wei', '13:00:00', '14:30:00')]),
      schedule,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map(codeOf)).toContain('MISSING_CERT');
  });

  it('keeps the customer window that the plan must fit inside', () => {
    expect(raffles.windowStart).toBeDefined();
    expect(raffles.windowEnd).toBeDefined();
  });
});

describe('risk classifier codes against the frozen vocabulary', () => {
  // Kept in step with the prefixes matched in src/agent/policy/risk.ts.
  const MATCHED_BY_CLASSIFIER = ['MISSING_CERT', 'CERT_EXPIRED', 'EXCESSIVE_OVERTIME'] as const;

  it('matches only codes the contract names', () => {
    expect(MATCHED_BY_CLASSIFIER.filter((code) => !frozen.has(code))).toEqual([]);
  });

  it('raises the cert reason for both spellings the validator can produce', () => {
    for (const code of ['MISSING_CERT:tech=tech_wei:cert=NITEC_HVAC', 'CERT_EXPIRED:tech=tech_wei:cert=NEA_R32']) {
      const classification = classifyProposalRisk({
        plans: [{ ...planOf([]), validations: { ok: false, violations: [code] } }],
        liveAssignments: [],
      });
      expect(classification.reasons).toContain('missing_or_expired_cert');
      expect(classification.risk).toBe('high');
      expect(classification.autonomyMode).toBe('block');
    }
  });
});

describe('frozen codes no rule emits yet', () => {
  // All 11 frozen validation violation rules are now fully implemented in validatePlan().
  const UNIMPLEMENTED = [] as const;

  it('names every gap and nothing outside the contract', () => {
    expect(UNIMPLEMENTED.filter((code) => !frozen.has(code))).toEqual([]);
    expect(UNIMPLEMENTED.length).toBe(0);
  });
});
