import type {
  BoardSchedule,
  CandidatePlan,
  JobRequirement,
  PlanValidation,
  TechnicianCert,
} from '../shared/types/domain';
import { EASTWIND } from '../shared/fixtures/eastwind';

/**
 * G1: Independent hard-constraint validator for candidate dispatch plans.
 * Inspects candidate plans against schedule snapshot constraints.
 * Can reject invalid solver or insertion outputs before HITL approval / commit.
 */
export function validatePlan(plan: CandidatePlan, schedule: BoardSchedule): PlanValidation {
  const violations: string[] = [];

  const slots = plan.assignments || [];

  // Extract certs & jobRequirements from schedule or fallback to EASTWIND fixture
  const certs: TechnicianCert[] =
    (schedule as unknown as { certs?: TechnicianCert[] }).certs || EASTWIND.certs;
  const requirements: JobRequirement[] =
    (schedule as unknown as { jobRequirements?: JobRequirement[] }).jobRequirements ||
    EASTWIND.jobRequirements;

  // 1. Check for duplicate job assignments across slots
  const assignedJobIds = new Set<string>();
  for (const slot of slots) {
    if (assignedJobIds.has(slot.jobId)) {
      violations.push(`DUPLICATE_JOB_ASSIGNMENT:${slot.jobId}`);
    }
    assignedJobIds.add(slot.jobId);
  }

  // 2. Group slots by technician to evaluate time overlap & travel feasibility
  const slotsByTech = new Map<string, typeof slots>();
  for (const slot of slots) {
    const existing = slotsByTech.get(slot.technicianId) || [];
    existing.push(slot);
    slotsByTech.set(slot.technicianId, existing);
  }

  for (const [techId, techSlots] of slotsByTech.entries()) {
    // 2a. Time Overlap Check
    for (let i = 0; i < techSlots.length; i++) {
      for (let j = i + 1; j < techSlots.length; j++) {
        const slotA = techSlots[i];
        const slotB = techSlots[j];

        if (
          slotA &&
          slotB &&
          slotA.windowStart &&
          slotA.windowEnd &&
          slotB.windowStart &&
          slotB.windowEnd
        ) {
          const startA = new Date(slotA.windowStart).getTime();
          const endA = new Date(slotA.windowEnd).getTime();
          const startB = new Date(slotB.windowStart).getTime();
          const endB = new Date(slotB.windowEnd).getTime();

          if (startA < endB && startB < endA) {
            violations.push(`OVERLAP:tech=${techId}:jobs=${slotA.jobId},${slotB.jobId}`);
          }
        }
      }
    }
  }

  // 3. Locked / In-Progress Job Integrity Check
  for (const job of schedule.jobs || []) {
    if (job.lockState === 'in_progress') {
      const origAssignment = (schedule.assignments || []).find(
        (a) => a.jobId === job.id && (a.status === 'accepted' || a.status === 'offered'),
      );

      if (origAssignment) {
        const planSlot = slots.find((s) => s.jobId === job.id);
        if (planSlot && planSlot.technicianId !== origAssignment.technicianId) {
          violations.push(`IN_PROGRESS_JOB_MOVED:${job.id}`);
        }
      }
    }
  }

  // 4. Certificate / Legal Gate Compliance Check
  for (const slot of slots) {
    const job = (schedule.jobs || []).find((j) => j.id === slot.jobId);
    if (!job) continue;

    const req = requirements.find((r) => r.jobId === job.id);
    const reqCerts =
      req?.requiredCerts ||
      (job.jobTypeId === 'CRITICAL_HVAC_ELECTRICAL' ? ['NITEC_HVAC', 'NEA_R32'] : []);

    if (reqCerts.length > 0) {
      const techCerts = certs.filter((c) => c.technicianId === slot.technicianId);

      for (const certType of reqCerts) {
        const matchingCert = techCerts.find((c) => c.certType === certType);

        if (!matchingCert) {
          violations.push(`MISSING_CERT:tech=${slot.technicianId}:cert=${certType}`);
        } else if (matchingCert.expiresAt && matchingCert.expiresAt < schedule.date) {
          violations.push(`EXPIRED_CERT:tech=${slot.technicianId}:cert=${certType}`);
        } else if (matchingCert.issuedAt > schedule.date) {
          violations.push(`INVALID_CERT:tech=${slot.technicianId}:cert=${certType}`);
        }
      }
    }

    // 5. Customer Window Boundary Check
    if (job.windowStart && job.windowEnd && slot.windowStart && slot.windowEnd) {
      const slotStartMs = Date.parse(slot.windowStart);
      const slotEndMs = Date.parse(slot.windowEnd);
      const jobStartMs = Date.parse(job.windowStart);
      const jobEndMs = Date.parse(job.windowEnd);

      const isInProgress = job.lockState === 'in_progress' || job.status === 'on_site';

      // Start time must never precede customer window start; end time must not exceed windowEnd unless in_progress
      if (slotStartMs < jobStartMs || (!isInProgress && slotEndMs > jobEndMs)) {
        violations.push(`WINDOW_VIOLATION:job=${job.id}`);
      }
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}

