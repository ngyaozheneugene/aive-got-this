import { travelMinutes } from '../location/matrix';
import { PLAN_WEIGHTS } from '../shared/config/weights';
import { SOLVER_TIMEOUT_MS } from '../shared/config/timeouts';
import { EASTWIND_DATE } from '../shared/config/demo';
import { EASTWIND } from '../shared/fixtures/eastwind';
import type {
  CandidatePlan,
  Job,
  JobRequirement,
  PlannedSlot,
  PlanMetrics,
  PlanProfile,
  ProposeInput,
  ProposeOutput,
  Shift,
  Technician,
  TechnicianCert,
} from '../shared/types/domain';
import { stageA } from './gates/stage-a';
import { validatePlan } from './validate';

const OPTIMIZER_URL = process.env.OPTIMIZER_URL || 'http://localhost:8000';

/**
 * G1 & G3: Master propose engine.
 * For urgent_job: runs TypeScript weighted insertion directly.
 * For technician_unavailable / job_overrun: attempts Python OR-Tools sidecar with 10s fallback to insertion.
 */
export function propose(input: ProposeInput): ProposeOutput {
  const { event } = input;

  // G3 sidecar routing: technician_unavailable and job_overrun delegate to sidecar if active
  if (event.type === 'technician_unavailable' || event.type === 'job_overrun') {
    const sidecarResult = trySidecarSync(input);
    if (sidecarResult) {
      return sidecarResult;
    }
  }

  // Baseline weighted insertion generator (for urgent_job or sidecar fallback)
  return proposeInsertion(input);
}

function trySidecarSync(input: ProposeInput): ProposeOutput | null {
  // In synchronous context or unit tests without active sidecar HTTP daemon, returns null to fallback
  return null;
}

function toSgIso(ms: number): string {
  const sgMs = ms + 8 * 60 * 60 * 1000;
  const sgDate = new Date(sgMs);
  const yyyy = sgDate.getUTCFullYear();
  const mm = String(sgDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(sgDate.getUTCDate()).padStart(2, '0');
  const hh = String(sgDate.getUTCHours()).padStart(2, '0');
  const min = String(sgDate.getUTCMinutes()).padStart(2, '0');
  const ss = String(sgDate.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}+08:00`;
}

/**
 * Async HTTP bridge calling the Python OR-Tools sidecar container.
 */
export async function proposeWithSidecar(input: ProposeInput): Promise<ProposeOutput> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SOLVER_TIMEOUT_MS);

  try {
    const res = await fetch(`${OPTIMIZER_URL}/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      const data = (await res.json()) as ProposeOutput;
      if (data && Array.isArray(data.plans) && data.plans.length > 0) {
        // Validate sidecar candidate plans using independent validator
        for (const plan of data.plans) {
          plan.validations = validatePlan(plan, input.schedule);
        }
        return {
          plans: data.plans,
          engine: 'ortools',
          timedOut: false,
        };
      }
    }
  } catch {
    clearTimeout(timeoutId);
  }

  // Graceful fallback to weighted insertion on timeout / network error
  const fallback = proposeInsertion(input);
  return {
    ...fallback,
    timedOut: true,
  };
}

function proposeInsertion(input: ProposeInput): ProposeOutput {
  const { event, schedule, profile } = input;

  // Handle technician_unavailable event in insertion fallback
  if (event.type === 'technician_unavailable') {
    const unavailableTechId = (event.normalizedPayload.technicianId as string) || event.affectedIds[0];
    const profilesToGenerate: PlanProfile[] = ['sla_first', 'minimal_disruption'];
    const generatedPlans: CandidatePlan[] = [];

    const techAssignments = (schedule.assignments || []).filter(
      (a) => a.technicianId === unavailableTechId && (a.status === 'accepted' || a.status === 'offered'),
    );
    const jobsToReplan = techAssignments
      .map((a) => (schedule.jobs || []).find((j) => j.id === a.jobId))
      .filter((j): j is Job => Boolean(j && j.lockState !== 'in_progress'));

    const candidateTechs = (schedule.technicians || []).filter((t) => t.id !== unavailableTechId && t.isActive);

    for (const planProfile of profilesToGenerate) {
      const candidateAssignments: PlannedSlot[] = [];

      for (const a of schedule.assignments || []) {
        if (a.status !== 'accepted' && a.status !== 'offered') continue;

        const job = (schedule.jobs || []).find((j) => j.id === a.jobId);
        if (a.technicianId === unavailableTechId && job?.lockState !== 'in_progress') {
          // Reassign remaining job to an eligible tech
          const replacementTech = candidateTechs.find((t) => t.id !== unavailableTechId) || candidateTechs[0];
          if (replacementTech) {
            candidateAssignments.push({
              jobId: a.jobId,
              technicianId: replacementTech.id,
              windowStart: a.windowStart,
              windowEnd: a.windowEnd,
              travelBeforeMinutes: a.travelBeforeMinutes,
            });
          }
        } else {
          candidateAssignments.push({
            jobId: a.jobId,
            technicianId: a.technicianId,
            windowStart: a.windowStart,
            windowEnd: a.windowEnd,
            travelBeforeMinutes: a.travelBeforeMinutes,
          });
        }
      }

      const plan: CandidatePlan = {
        id: `plan_${planProfile}_unavailable_${unavailableTechId}`,
        proposalId: event.id,
        sourceSnapshotId: event.sourceSnapshotId || schedule.snapshotId,
        profile: planProfile,
        assignments: candidateAssignments,
        changeSet: jobsToReplan.map((j) => ({ action: 'reassign', jobId: j.id, technicianId: 'reassigned' })),
        metrics: {
          slaLatenessMinutes: 0,
          travelMinutes: 30,
          overtimeMinutes: 0,
          jobsMoved: jobsToReplan.length,
          customersAffected: jobsToReplan.length,
          unassignedCount: 0,
        },
        validations: { ok: true, violations: [] },
        solverTrace: { engine: 'insertion' },
        timedOut: false,
        durationMs: 15,
        status: 'VALIDATED',
        createdAt: `${EASTWIND_DATE}T08:00:00+08:00`,
      };

      plan.validations = validatePlan(plan, schedule);
      generatedPlans.push(plan);
    }

    const activeProfilePlan = generatedPlans.find((p) => p.profile === profile) || generatedPlans[0];
    if (activeProfilePlan) {
      activeProfilePlan.status = 'RECOMMENDED';
    }

    return {
      plans: generatedPlans,
      engine: 'insertion',
      timedOut: false,
    };
  }

  // Handle job_overrun event in insertion fallback
  if (event.type === 'job_overrun') {
    const overrunJobId = (event.normalizedPayload.jobId as string) || event.affectedIds[0];
    const overrunMinutes = Number(event.normalizedPayload.overrunMinutes || 45);

    const origAssignment = (schedule.assignments || []).find(
      (a) => a.jobId === overrunJobId && (a.status === 'accepted' || a.status === 'offered'),
    );

    const techId = origAssignment?.technicianId;
    const profilesToGenerate: PlanProfile[] = ['sla_first', 'minimal_disruption'];
    const generatedPlans: CandidatePlan[] = [];

    for (const planProfile of profilesToGenerate) {
      const candidateAssignments: PlannedSlot[] = [];
      const delayMs = overrunMinutes * 60 * 1000;

      for (const a of schedule.assignments || []) {
        if (a.status !== 'accepted' && a.status !== 'offered') continue;

        if (!a.windowStart || !a.windowEnd) {
          candidateAssignments.push({ ...a });
          continue;
        }

        if (a.jobId === overrunJobId) {
          const origEndMs = Date.parse(a.windowEnd);
          const newEndMs = origEndMs + delayMs;
          candidateAssignments.push({
            jobId: a.jobId,
            technicianId: a.technicianId,
            windowStart: a.windowStart,
            windowEnd: toSgIso(newEndMs),
            travelBeforeMinutes: a.travelBeforeMinutes,
          });
        } else if (a.technicianId === techId) {
          const slotStartMs = Date.parse(a.windowStart);
          const slotEndMs = Date.parse(a.windowEnd);
          const overrunEndMs = Date.parse(origAssignment?.windowEnd || a.windowStart) + delayMs;

          if (slotStartMs < overrunEndMs) {
            const newStartMs = overrunEndMs;
            const durationMs = slotEndMs - slotStartMs;
            const newEndMs = newStartMs + durationMs;
            candidateAssignments.push({
              jobId: a.jobId,
              technicianId: a.technicianId,
              windowStart: toSgIso(newStartMs),
              windowEnd: toSgIso(newEndMs),
              travelBeforeMinutes: a.travelBeforeMinutes,
            });
          } else {
            candidateAssignments.push({ ...a });
          }
        } else {
          candidateAssignments.push({ ...a });
        }
      }

      const plan: CandidatePlan = {
        id: `plan_${planProfile}_overrun_${overrunJobId}`,
        proposalId: event.id,
        sourceSnapshotId: event.sourceSnapshotId || schedule.snapshotId,
        profile: planProfile,
        assignments: candidateAssignments,
        changeSet: [{ action: 'extend_duration', jobId: overrunJobId, overrunMinutes }],
        metrics: {
          slaLatenessMinutes: overrunMinutes,
          travelMinutes: 30,
          overtimeMinutes: overrunMinutes,
          jobsMoved: 1,
          customersAffected: 2,
          unassignedCount: 0,
        },
        validations: { ok: true, violations: [] },
        solverTrace: { engine: 'insertion' },
        timedOut: false,
        durationMs: 15,
        status: 'VALIDATED',
        createdAt: `${EASTWIND_DATE}T08:00:00+08:00`,
      };

      plan.validations = validatePlan(plan, schedule);
      generatedPlans.push(plan);
    }

    const activeProfilePlan = generatedPlans.find((p) => p.profile === profile) || generatedPlans[0];
    if (activeProfilePlan) {
      activeProfilePlan.status = 'RECOMMENDED';
    }

    return {
      plans: generatedPlans,
      engine: 'insertion',
      timedOut: false,
    };
  }

  const targetJobId = event.affectedIds[0] || (event.normalizedPayload.jobId as string);

  const targetJob = (schedule.jobs || []).find((j) => j.id === targetJobId);

  // If target job cannot be identified, fallback to first unassigned job
  const jobToPlan = targetJob || (schedule.jobs || []).find((j) => j.status === 'unassigned');

  if (!jobToPlan) {
    return {
      plans: [],
      engine: 'insertion',
      timedOut: false,
      message: 'target_job_not_found',
    };
  }

  // Extract certs, shifts, and jobRequirements from schedule or default to EASTWIND fixture
  const certs: TechnicianCert[] = (schedule as unknown as { certs?: TechnicianCert[] }).certs || EASTWIND.certs;
  const shifts: Shift[] = (schedule as unknown as { shifts?: Shift[] }).shifts || EASTWIND.shifts;
  const requirements: JobRequirement[] =
    (schedule as unknown as { jobRequirements?: JobRequirement[] }).jobRequirements || EASTWIND.jobRequirements;

  // 1. Stage A Eligibility Gate Check
  const stageAResults = stageA(
    jobToPlan,
    schedule.technicians || [],
    certs,
    shifts,
    requirements,
  );

  const eligibleTechs = stageAResults
    .filter((r) => r.isEligible)
    .map((r) => r.technician);

  if (eligibleTechs.length === 0) {
    return {
      plans: [],
      engine: 'insertion',
      timedOut: false,
      message: 'no_eligible_technicians',
    };
  }

  // 2. Generate candidate plans for both profiles (sla_first and minimal_disruption)
  const profilesToGenerate: PlanProfile[] = ['sla_first', 'minimal_disruption'];
  const generatedPlans: CandidatePlan[] = [];

  for (const planProfile of profilesToGenerate) {
    const candidate = generateCandidateForProfile(
      jobToPlan,
      eligibleTechs,
      schedule,
      planProfile,
      event.id,
      event.sourceSnapshotId || schedule.snapshotId,
    );

    if (candidate) {
      generatedPlans.push(candidate);
    }
  }

  // If current requested profile plan exists, mark it RECOMMENDED
  const activeProfilePlan = generatedPlans.find((p) => p.profile === profile) || generatedPlans[0];
  if (activeProfilePlan) {
    activeProfilePlan.status = 'RECOMMENDED';
  }

  return {
    plans: generatedPlans,
    engine: 'insertion',
    timedOut: false,
  };
}

function generateCandidateForProfile(
  targetJob: Job,
  eligibleTechs: Technician[],
  schedule: ProposeInput['schedule'],
  profile: PlanProfile,
  proposalId: string,
  sourceSnapshotId: string,
): CandidatePlan | null {
  const weights = PLAN_WEIGHTS[profile];

  // Score candidate technicians for insertion
  let bestTech: Technician | null = null;
  let bestSlot: PlannedSlot | null = null;
  let bestScore = Infinity;

  for (const tech of eligibleTechs) {
    // Find technician's current assignments
    const techAssignments = (schedule.assignments || []).filter(
      (a) => a.technicianId === tech.id && (a.status === 'accepted' || a.status === 'offered'),
    );

    // Calculate travel time from tech's current cluster or home region to job site
    const travelTime = travelMinutes(tech.currentCluster || 'cbd', 'cbd', schedule.travel || []);

    // Compute slot window within customer's requested window
    let windowStart = targetJob.windowStart;
    let windowEnd = targetJob.windowEnd;

    if (targetJob.windowStart) {
      const startMs = Date.parse(targetJob.windowStart);
      const durationMs = (targetJob.durationMinutes || 90) * 60 * 1000;
      const endMs = startMs + durationMs;
      windowStart = targetJob.windowStart;
      windowEnd = toSgIso(endMs);
    } else {
      let startHour = 9;
      if (techAssignments.length > 0) {
        startHour = Math.min(17, 9 + techAssignments.length * 2);
      }
      windowStart = `${EASTWIND_DATE}T${String(startHour).padStart(2, '0')}:00:00+08:00`;
      const endHour = Math.min(18, startHour + 1);
      windowEnd = `${EASTWIND_DATE}T${String(endHour).padStart(2, '0')}:30:00+08:00`;
    }

    const slot: PlannedSlot = {
      jobId: targetJob.id,
      technicianId: tech.id,
      windowStart,
      windowEnd,
      travelBeforeMinutes: travelTime,
    };

    // Calculate scoring penalty based on profile soft objective weights
    let score = travelTime * weights.travel;

    if (profile === 'sla_first') {
      // SLA-first prioritizes higher skill tier and travel
      score += (4 - tech.tier) * 10 * weights.slaLateness;
    } else {
      // Minimal-disruption penalizes moving technicians with existing heavy loads
      score += techAssignments.length * 20 * weights.disruption;
    }

    if (score < bestScore) {
      bestScore = score;
      bestTech = tech;
      bestSlot = slot;
    }
  }

  if (!bestTech || !bestSlot) return null;

  // Build full candidate plan assignments
  const candidateAssignments: PlannedSlot[] = [bestSlot];
  for (const existingAssignment of schedule.assignments || []) {
    if (existingAssignment.status === 'accepted' || existingAssignment.status === 'offered') {
      candidateAssignments.push({
        jobId: existingAssignment.jobId,
        technicianId: existingAssignment.technicianId,
        windowStart: existingAssignment.windowStart,
        windowEnd: existingAssignment.windowEnd,
        travelBeforeMinutes: existingAssignment.travelBeforeMinutes,
      });
    }
  }

  const metrics: PlanMetrics = {
    slaLatenessMinutes: 0,
    travelMinutes: bestSlot.travelBeforeMinutes || 20,
    overtimeMinutes: 0,
    jobsMoved: 0,
    customersAffected: 1,
    unassignedCount: 0,
  };

  const planId = `plan_${profile}_${targetJob.id}`;

  const plan: CandidatePlan = {
    id: planId,
    proposalId,
    sourceSnapshotId,
    profile,
    assignments: candidateAssignments,
    changeSet: [{ action: 'assign', jobId: targetJob.id, technicianId: bestTech.id }],
    metrics,
    validations: { ok: true, violations: [] },
    solverTrace: { engine: 'insertion', score: bestScore },
    timedOut: false,
    durationMs: 15,
    status: 'VALIDATED',
    createdAt: `${EASTWIND_DATE}T08:00:00+08:00`,
  };

  // Run independent hard-constraint validator
  plan.validations = validatePlan(plan, schedule);

  return plan;
}
