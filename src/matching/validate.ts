import type { BoardSchedule, CandidatePlan, PlanValidation } from '../shared/types/domain';

/**
 * G1: Independent hard-constraint validator for candidate dispatch plans.
 * Inspects candidate plans against schedule snapshot constraints.
 * Can reject invalid solver or insertion outputs before HITL approval / commit.
 */
export function validatePlan(plan: CandidatePlan, schedule: BoardSchedule): PlanValidation {
  const violations: string[] = [];

  const slots = plan.assignments || [];

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

  return {
    ok: violations.length === 0,
    violations,
  };
}
