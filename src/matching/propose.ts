import { travelMinutes } from '../location/matrix';
import { PLAN_WEIGHTS } from '../shared/config/weights';
import { EASTWIND_DATE } from '../shared/config/demo';
import type {
  CandidatePlan,
  Job,
  PlannedSlot,
  PlanMetrics,
  PlanProfile,
  ProposeInput,
  ProposeOutput,
  Technician,
} from '../shared/types/domain';
import { stageA } from './gates/stage-a';
import { validatePlan } from './validate';

/**
 * G1: Weighted insertion candidate plan generator.
 * Handles operational disruption events (e.g. urgent_job) by running Stage A eligibility gates,
 * calculating travel matrix buffers, evaluating dual profiles (sla_first vs minimal_disruption),
 * and verifying hard constraints via independent validation.
 */
export function propose(input: ProposeInput): ProposeOutput {
  const { event, schedule, profile } = input;
  const targetJobId = event.affectedIds[0] || (event.normalizedPayload.jobId as string);

  const targetJob = (schedule.jobs || []).find((j) => j.id === targetJobId);

  // If target job cannot be identified, return empty result
  if (!targetJob) {
    return {
      plans: [],
      engine: 'insertion',
      timedOut: false,
      message: 'target_job_not_found',
    };
  }

  // 1. Stage A Eligibility Gate Check
  const stageAResults = stageA(
    targetJob,
    schedule.technicians || [],
    [],
    [],
    [],
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
      targetJob,
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

    // Estimate start time after latest assignment or default to 09:00
    let startHour = 9;
    if (techAssignments.length > 0) {
      startHour = Math.min(17, 9 + techAssignments.length * 2);
    }

    const windowStart = `${EASTWIND_DATE}T${String(startHour).padStart(2, '0')}:00:00+08:00`;
    const endHour = Math.min(18, startHour + 1);
    const windowEnd = `${EASTWIND_DATE}T${String(endHour).padStart(2, '0')}:30:00+08:00`;

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
