import type {
  BoardSchedule,
  CandidatePlan,
  JobRequirement,
  PlanValidation,
  TechnicianCert,
} from '../shared/types/domain';
import { VALIDATION_VIOLATIONS } from '../shared/config/reason-codes';
import { EASTWIND } from '../shared/fixtures/eastwind';
import { travelMinutes } from '../location/matrix';

/**
 * The frozen violation vocabulary. Every code this file emits is checked against
 * it at compile time.
 *
 * This is load-bearing rather than cosmetic: the desk renders these codes, and
 * `classifyProposalRisk` matches on them to decide AUTO / APPROVAL / BLOCK.
 */
type ViolationCode = (typeof VALIDATION_VIOLATIONS)[number];

function violation(code: ViolationCode, detail?: string): string {
  return detail ? `${code}:${detail}` : code;
}

/**
 * G1: Independent hard-constraint validator for candidate dispatch plans.
 * Inspects candidate plans against schedule snapshot constraints.
 * Can reject invalid solver or insertion outputs before HITL approval / commit.
 */
export function validatePlan(plan: CandidatePlan, schedule: BoardSchedule): PlanValidation {
  const violations: string[] = [];

  const slots = plan.assignments || [];

  const certs: TechnicianCert[] = schedule.certs ?? EASTWIND.certs;
  const requirements: JobRequirement[] = schedule.jobRequirements ?? EASTWIND.jobRequirements;
  const shifts = schedule.shifts ?? EASTWIND.shifts;
  const travelMatrix = schedule.travel ?? EASTWIND.travel;
  const sites = schedule.sites ?? EASTWIND.sites;

  // 1. Check for duplicate job assignments across slots
  const assignedJobIds = new Set<string>();
  for (const slot of slots) {
    if (assignedJobIds.has(slot.jobId)) {
      violations.push(violation('DUPLICATE_ASSIGNMENT', slot.jobId));
    }
    assignedJobIds.add(slot.jobId);
  }

  // 2. Group slots by technician to evaluate time overlap, travel feasibility, and overtime
  const slotsByTech = new Map<string, typeof slots>();
  for (const slot of slots) {
    const existing = slotsByTech.get(slot.technicianId) || [];
    existing.push(slot);
    slotsByTech.set(slot.technicianId, existing);
  }

  for (const [techId, techSlots] of slotsByTech.entries()) {
    const sortedSlots = [...techSlots].sort((a, b) => {
      const startA = a.windowStart ? Date.parse(a.windowStart) : 0;
      const startB = b.windowStart ? Date.parse(b.windowStart) : 0;
      return startA - startB;
    });

    // 2a. Time Overlap & Travel Feasibility Check
    for (let i = 0; i < sortedSlots.length; i++) {
      for (let j = i + 1; j < sortedSlots.length; j++) {
        const slotA = sortedSlots[i];
        const slotB = sortedSlots[j];

        if (
          slotA &&
          slotB &&
          slotA.windowStart &&
          slotA.windowEnd &&
          slotB.windowStart &&
          slotB.windowEnd
        ) {
          const startA = Date.parse(slotA.windowStart);
          const endA = Date.parse(slotA.windowEnd);
          const startB = Date.parse(slotB.windowStart);
          const endB = Date.parse(slotB.windowEnd);

          if (startA < endB && startB < endA) {
            violations.push(violation('OVERLAP', `tech=${techId}:jobs=${slotA.jobId},${slotB.jobId}`));
          } else if (i + 1 === j && endA <= startB) {
            const jobA = (schedule.jobs || []).find((row) => row.id === slotA.jobId);
            const jobB = (schedule.jobs || []).find((row) => row.id === slotB.jobId);
            const siteA = sites.find((s) => s.id === jobA?.siteId);
            const siteB = sites.find((s) => s.id === jobB?.siteId);

            const clusterA = siteA?.estateCluster || 'cbd';
            const clusterB = siteB?.estateCluster || 'cbd';

            let requiredTravelMins = 0;
            try {
              requiredTravelMins = travelMinutes(clusterA, clusterB, travelMatrix);
            } catch {
              requiredTravelMins = 20;
            }

            const gapMins = (startB - endA) / 60000;
            if (gapMins < requiredTravelMins) {
              violations.push(violation('TRAVEL_INFEASIBLE', `tech=${techId}:jobs=${slotA.jobId},${slotB.jobId}`));
            }
          }
        }
      }
    }

    // 2b. Excessive Overtime Check
    const tech = (schedule.technicians || []).find((t) => t.id === techId);
    if (tech) {
      let totalWorkMinutes = 0;
      for (const slot of sortedSlots) {
        if (slot.windowStart && slot.windowEnd) {
          totalWorkMinutes += (Date.parse(slot.windowEnd) - Date.parse(slot.windowStart)) / 60000;
        }
      }
      const maxAllowedMinutes = tech.maxMinutesDay + (tech.acceptsOt ? 120 : 0);
      if (totalWorkMinutes > maxAllowedMinutes) {
        violations.push(violation('EXCESSIVE_OVERTIME', `tech=${techId}`));
      }
    }
  }

  // 3. Locked / In-Progress Job Integrity Check
  for (const job of schedule.jobs || []) {
    const origAssignment = (schedule.assignments || []).find(
      (a) => a.jobId === job.id && (a.status === 'accepted' || a.status === 'offered'),
    );

    if (origAssignment) {
      const planSlot = slots.find((s) => s.jobId === job.id);
      if (job.lockState === 'in_progress') {
        if (planSlot && planSlot.technicianId !== origAssignment.technicianId) {
          violations.push(violation('IN_PROGRESS_MOVED', job.id));
        }
      } else if (job.lockState === 'promised') {
        if (planSlot && planSlot.technicianId !== origAssignment.technicianId) {
          violations.push(violation('LOCKED_MOVED', job.id));
        }
      }
    }
  }

  // 4. Certificate, Shift, Parts & Legal Gate Compliance Check
  for (const slot of slots) {
    const job = (schedule.jobs || []).find((j) => j.id === slot.jobId);
    if (!job) continue;

    const tech = (schedule.technicians || []).find((t) => t.id === slot.technicianId);

    // Shift check
    const techShift = shifts.find(
      (s) => s.technicianId === slot.technicianId && s.shiftDate === schedule.date,
    );
    if (!techShift || techShift.status === 'mc' || techShift.status === 'no_show') {
      violations.push(violation('OUTSIDE_SHIFT', `tech=${slot.technicianId}:job=${job.id}`));
    } else if (techShift.clockInAt && slot.windowStart) {
      if (Date.parse(slot.windowStart) < Date.parse(techShift.clockInAt)) {
        violations.push(violation('OUTSIDE_SHIFT', `tech=${slot.technicianId}:job=${job.id}`));
      }
    }

    // Carried parts check
    if (job.partsRequired && job.partsRequired.length > 0) {
      const techParts = tech?.parts || [];
      const hasAllParts = job.partsRequired.every((p) => techParts.includes(p));
      if (!hasAllParts) {
        violations.push(violation('MISSING_PARTS', `tech=${slot.technicianId}:job=${job.id}`));
      }
    }

    // Cert check
    const req = requirements.find((r) => r.jobId === job.id);
    const reqCerts =
      req?.requiredCerts ||
      (job.jobTypeId === 'CRITICAL_HVAC_ELECTRICAL' ? ['NITEC_HVAC', 'NEA_R32'] : []);

    if (reqCerts.length > 0) {
      const techCerts = certs.filter((c) => c.technicianId === slot.technicianId);

      for (const certType of reqCerts) {
        const matchingCert = techCerts.find((c) => c.certType === certType);

        if (!matchingCert) {
          violations.push(violation('MISSING_CERT', `tech=${slot.technicianId}:cert=${certType}`));
        } else if (matchingCert.expiresAt && matchingCert.expiresAt < schedule.date) {
          violations.push(violation('CERT_EXPIRED', `tech=${slot.technicianId}:cert=${certType}`));
        } else if (matchingCert.issuedAt > schedule.date) {
          violations.push(
            violation('MISSING_CERT', `tech=${slot.technicianId}:cert=${certType}:not_yet_issued`),
          );
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

      if (slotStartMs < jobStartMs || (!isInProgress && slotEndMs > jobEndMs)) {
        violations.push(violation('WINDOW_INFEASIBLE', `job=${job.id}`));
      }
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}

