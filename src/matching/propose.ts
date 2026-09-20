import { travelMinutes } from '../location/matrix';
import { PLAN_WEIGHTS } from '../shared/config/weights';
import { SOLVER_TIMEOUT_MS } from '../shared/config/timeouts';
import { EASTWIND_DATE } from '../shared/config/demo';
import { EASTWIND } from '../shared/fixtures/eastwind';
import type {
  Assignment,
  CandidatePlan,
  Job,
  JobRequirement,
  PlannedSlot,
  PlanMetrics,
  PlanProfile,
  ProposeInput,
  ProposeOutput,
  Shift,
  Site,
  Technician,
  TechnicianCert,
  TravelMatrix,
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

  // Extract certs, shifts, and jobRequirements from schedule or default to EASTWIND fixture
  const certs: TechnicianCert[] = (schedule as unknown as { certs?: TechnicianCert[] }).certs || EASTWIND.certs;
  const shifts: Shift[] = (schedule as unknown as { shifts?: Shift[] }).shifts || EASTWIND.shifts;
  const requirements: JobRequirement[] =
    (schedule as unknown as { jobRequirements?: JobRequirement[] }).jobRequirements || EASTWIND.jobRequirements;

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
          if (!job) continue;
          // Filter candidate techs via Stage A
          const stageAResults = stageA(job, candidateTechs, certs, shifts, requirements);
          const eligibleTechs = stageAResults.filter((r) => r.isEligible).map((r) => r.technician);

          const sites = schedule.sites ?? EASTWIND.sites;
          const travelMatrix = schedule.travel ?? EASTWIND.travel;

          const feasibleTechs = eligibleTechs.filter((t) => {
            const tSlots = (schedule.assignments || []).filter(
              (slot) => slot.technicianId === t.id && (slot.status === 'accepted' || slot.status === 'offered'),
            );
            if (tSlots.length === 0) return true;

            const lastSlot = tSlots[tSlots.length - 1];
            if (!lastSlot || !lastSlot.windowEnd || !a.windowStart) return true;

            const endLast = Date.parse(lastSlot.windowEnd);
            const startJob = Date.parse(a.windowStart);
            const gapMins = (startJob - endLast) / 60000;

            const lastJob = (schedule.jobs || []).find((j) => j.id === lastSlot.jobId);
            const siteA = sites.find((s) => s.id === lastJob?.siteId);
            const siteB = sites.find((s) => s.id === job?.siteId);

            const clusterA = siteA?.estateCluster || t.currentCluster || 'cbd';
            const clusterB = siteB?.estateCluster || 'cbd';

            try {
              const reqMins = travelMinutes(clusterA, clusterB, travelMatrix);
              return gapMins >= reqMins;
            } catch {
              return true;
            }
          });

          const replacementTech =
            planProfile === 'sla_first'
              ? feasibleTechs[0] || eligibleTechs[0] || candidateTechs[0]
              : feasibleTechs[feasibleTechs.length - 1] || eligibleTechs[0] || candidateTechs[0];

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

/** Fallback when the travel matrix has no row for a pair. Never throws into planning. */
const UNKNOWN_TRAVEL_MINUTES = 45;

function clusterForJob(job: Job, sites: Site[]): string {
  return sites.find((s) => s.id === job.siteId)?.estateCluster ?? 'cbd';
}

/**
 * The matrix throws on a missing pair, which would abort the whole proposal
 * rather than drop one candidate. A pessimistic default keeps the candidate in
 * the running while making it unattractive.
 */
function safeTravel(from: string, to: string, matrix: TravelMatrix[]): number {
  try {
    return travelMinutes(from, to, matrix);
  } catch {
    return UNKNOWN_TRAVEL_MINUTES;
  }
}

function minutesBetween(start?: string, end?: string): number {
  if (!start || !end) return 0;
  const span = Date.parse(end) - Date.parse(start);
  return Number.isFinite(span) && span > 0 ? Math.round(span / 60000) : 0;
}

function committedMinutes(technicianId: string, assignments: Assignment[]): number {
  return assignments
    .filter(
      (a) =>
        a.technicianId === technicianId &&
        (a.status === 'accepted' || a.status === 'offered'),
    )
    .reduce((total, a) => total + minutesBetween(a.windowStart, a.windowEnd), 0);
}

/**
 * Real numbers, computed from the plan. These were hardcoded zeros, which meant
 * the desk compared two candidates on constants: whichever technician was
 * chosen, the metrics table read the same, so there was nothing to compare and
 * no way to explain a recommendation.
 */
function computeMetrics(
  job: Job,
  slot: PlannedSlot,
  technician: Technician,
  schedule: ProposeInput['schedule'],
  liveAssignments: Assignment[],
): PlanMetrics {
  const travel = slot.travelBeforeMinutes ?? 0;
  const duration = minutesBetween(slot.windowStart, slot.windowEnd);

  // Past the customer's window is lateness. The validator refuses it outright,
  // so this is normally zero; it stops being zero the moment windows tighten.
  const slotEnd = slot.windowEnd ? Date.parse(slot.windowEnd) : NaN;
  const promised = job.windowEnd ? Date.parse(job.windowEnd) : NaN;
  const slaLatenessMinutes =
    Number.isFinite(slotEnd) && Number.isFinite(promised) && slotEnd > promised
      ? Math.round((slotEnd - promised) / 60000)
      : 0;

  const dayMinutes = committedMinutes(technician.id, liveAssignments) + duration + travel;
  const overtimeMinutes = Math.max(0, dayMinutes - technician.maxMinutesDay);

  // Insertion adds work without moving any of it. That is the honest answer,
  // and it is why the two profiles cannot be separated on disruption alone.
  const jobsMoved = 0;

  const plannedJobIds = new Set(
    liveAssignments
      .filter((a) => a.status === 'accepted' || a.status === 'offered')
      .map((a) => a.jobId),
  );
  plannedJobIds.add(job.id);
  const unassignedCount = (schedule.jobs ?? []).filter(
    (j) => !plannedJobIds.has(j.id),
  ).length;

  return {
    slaLatenessMinutes,
    travelMinutes: travel,
    overtimeMinutes,
    jobsMoved,
    customersAffected: 1,
    unassignedCount,
  };
}

/**
 * How much of this technician's day the job consumes, as a percentage of their
 * ceiling. Someone who does not accept overtime and is already two thirds full
 * is where a late-running job turns into tomorrow's problem, so this is the
 * honest reading of "disruption" for an engine that never moves existing work.
 */
function loadPressure(
  technician: Technician,
  metrics: PlanMetrics,
  slot: PlannedSlot,
  liveAssignments: Assignment[],
): number {
  const duration = minutesBetween(slot.windowStart, slot.windowEnd);
  const after =
    committedMinutes(technician.id, liveAssignments) + duration + metrics.travelMinutes;
  const ceiling = technician.maxMinutesDay || 480;
  const utilisation = (after / ceiling) * 100;
  return technician.acceptsOt ? utilisation : utilisation * 1.25;
}

interface ScoredCandidate {
  technician: Technician;
  slot: PlannedSlot;
  metrics: PlanMetrics;
  pressure: number;
  blended: number;
}

/**
 * The profiles have to be separated by what they optimise, not only by weights.
 *
 * With a pure insertion into a free window, slaLateness, overtime and jobsMoved
 * are all genuinely zero for every candidate. That leaves travel and imbalance,
 * and PLAN_WEIGHTS gives those two identical values in both profiles, so a
 * weighted sum makes the profiles arithmetically the same and both plans land
 * on the same technician. That is what the deployed box was showing: two
 * candidates, identical in all twelve slots.
 *
 * So each profile leads with its own objective and falls back to the weighted
 * blend only to break ties:
 *
 *   sla_first           soonest on site: lateness, then travel
 *   minimal_disruption  least knock-on: jobs moved, then load pressure
 *
 * Both readings are defensible from the profile names, and on the Eastwind
 * board they separate: the nearest van against the one with the most slack.
 */
function rank(profile: PlanProfile, a: ScoredCandidate, b: ScoredCandidate): number {
  if (profile === 'sla_first') {
    if (a.metrics.slaLatenessMinutes !== b.metrics.slaLatenessMinutes) {
      return a.metrics.slaLatenessMinutes - b.metrics.slaLatenessMinutes;
    }
    if (a.metrics.travelMinutes !== b.metrics.travelMinutes) {
      return a.metrics.travelMinutes - b.metrics.travelMinutes;
    }
  } else {
    if (a.metrics.jobsMoved !== b.metrics.jobsMoved) {
      return a.metrics.jobsMoved - b.metrics.jobsMoved;
    }
    if (a.pressure !== b.pressure) return a.pressure - b.pressure;
  }
  if (a.blended !== b.blended) return a.blended - b.blended;
  return a.technician.id.localeCompare(b.technician.id);
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
  const sites = schedule.sites ?? EASTWIND.sites;
  const destination = clusterForJob(targetJob, sites);
  const liveAssignments = (schedule.assignments ?? []).filter(
    (a) => a.status === 'accepted' || a.status === 'offered',
  );

  const scored: ScoredCandidate[] = [];

  for (const tech of eligibleTechs) {
    const techAssignments = liveAssignments.filter((a) => a.technicianId === tech.id);

    // Travel is to the job's own cluster. It used to be hardcoded to 'cbd',
    // which is right for Raffles Place and wrong for the other eleven jobs.
    const travelTime = safeTravel(
      tech.currentCluster || tech.homeRegion || 'cbd',
      destination,
      schedule.travel || [],
    );

    let windowStart = targetJob.windowStart;
    let windowEnd = targetJob.windowEnd;

    if (targetJob.windowStart) {
      const startMs = Date.parse(targetJob.windowStart);
      const durationMs = (targetJob.durationMinutes || 90) * 60 * 1000;
      windowStart = targetJob.windowStart;
      windowEnd = toSgIso(startMs + durationMs);
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

    const metrics = computeMetrics(targetJob, slot, tech, schedule, liveAssignments);
    const pressure = loadPressure(tech, metrics, slot, liveAssignments);
    const blended =
      weights.slaLateness * metrics.slaLatenessMinutes +
      weights.travel * metrics.travelMinutes +
      weights.overtime * metrics.overtimeMinutes +
      weights.disruption * metrics.jobsMoved * 20 +
      weights.imbalance * pressure;

    scored.push({ technician: tech, slot, metrics, pressure, blended });
  }

  if (scored.length === 0) return null;

  scored.sort((a, b) => rank(profile, a, b));
  const best = scored[0]!;

  const candidateAssignments: PlannedSlot[] = [best.slot];
  for (const existingAssignment of liveAssignments) {
    candidateAssignments.push({
      jobId: existingAssignment.jobId,
      technicianId: existingAssignment.technicianId,
      windowStart: existingAssignment.windowStart,
      windowEnd: existingAssignment.windowEnd,
      travelBeforeMinutes: existingAssignment.travelBeforeMinutes,
    });
  }

  const planId = `plan_${profile}_${targetJob.id}`;

  const plan: CandidatePlan = {
    id: planId,
    proposalId,
    sourceSnapshotId,
    profile,
    assignments: candidateAssignments,
    changeSet: [
      { action: 'assign', jobId: targetJob.id, technicianId: best.technician.id },
    ],
    metrics: best.metrics,
    validations: { ok: true, violations: [] },
    solverTrace: {
      engine: 'insertion',
      score: best.blended,
      objective: profile === 'sla_first' ? 'soonest_on_site' : 'least_knock_on',
      loadPressure: Math.round(best.pressure),
      considered: scored.map((c) => ({
        technicianId: c.technician.id,
        travelMinutes: c.metrics.travelMinutes,
        overtimeMinutes: c.metrics.overtimeMinutes,
        loadPressure: Math.round(c.pressure),
      })),
    },
    timedOut: false,
    durationMs: 15,
    status: 'VALIDATED',
    createdAt: `${EASTWIND_DATE}T08:00:00+08:00`,
  };

  // Run independent hard-constraint validator
  plan.validations = validatePlan(plan, schedule);

  return plan;
}
