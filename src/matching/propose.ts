import { travelMinutes } from '../location/matrix';
import { PLAN_WEIGHTS } from '../shared/config/weights';
import { SOLVER_TIMEOUT_MS } from '../shared/config/timeouts';
import { EASTWIND_DATE } from '../shared/config/demo';
import { applyDisruption, withinShift } from './disruption';
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
import { measurePlan, slotChanged, UNKNOWN_TRAVEL_MINUTES, type TechnicianWorkload } from './measure';

const OPTIMIZER_URL = process.env.OPTIMIZER_URL || 'http://localhost:8000';

/**
 * G1 & G3: Master propose engine.
 * For urgent_job: runs TypeScript weighted insertion directly.
 * For technician_unavailable / job_overrun: attempts Python OR-Tools sidecar with 10s fallback to insertion.
 */
export function propose(rawInput: ProposeInput): ProposeOutput {
  const input = withDisruption(rawInput);
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
/**
 * Stage A's verdict for every job on the board: who may legally take it.
 *
 * The sidecar receives this rather than re-deriving it, so certificates, tier,
 * parts, tools and shift status have exactly one implementation. Before this,
 * the solver had none of those rules and placed Wei on Raffles Place, which the
 * validator then correctly refused, leaving no legal candidate at all.
 */
function eligibilityFor(schedule: ProposeInput['schedule']): Record<string, string[]> {
  const certs: TechnicianCert[] = schedule.certs ?? EASTWIND.certs;
  const shifts: Shift[] = schedule.shifts ?? EASTWIND.shifts;
  const requirements: JobRequirement[] = schedule.jobRequirements ?? EASTWIND.jobRequirements;
  const verdict: Record<string, string[]> = {};
  for (const job of schedule.jobs ?? []) {
    verdict[job.id] = stageA(job, schedule.technicians ?? [], certs, shifts, requirements)
      .filter((r) => r.isEligible)
      .map((r) => r.technician.id);
  }
  return verdict;
}

/**
 * The board as it is once the event has happened: an unavailable technician's
 * shift is cut. Idempotent, so a caller that already applied it loses nothing.
 */
function withDisruption(input: ProposeInput): ProposeInput {
  return { ...input, schedule: applyDisruption(input.schedule, input.event) };
}

export async function proposeWithSidecar(rawInput: ProposeInput): Promise<ProposeOutput> {
  const input = withDisruption(rawInput);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SOLVER_TIMEOUT_MS);

  // Whether the sidecar actually answered. An answer of "no plan" is a verdict,
  // not a timeout: labelling it timedOut made the planning endpoint report the
  // retryable scheduler_timeout, so a coordinator would retry an event that no
  // legal plan can ever satisfy, and get the same result every time.
  let answered = false;
  let sidecarMessage: string | undefined;

  try {
    const res = await fetch(`${OPTIMIZER_URL}/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, eligibility: eligibilityFor(input.schedule) }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      const data = (await res.json()) as ProposeOutput;
      answered = true;
      sidecarMessage = data?.message;
      if (data && Array.isArray(data.plans) && data.plans.length > 0) {
        // Validate sidecar candidate plans using independent validator, and
        // measure them here so every engine's numbers mean the same thing.
        for (const plan of data.plans) {
          plan.validations = validatePlan(plan, input.schedule);
          const { metrics, workload } = measurePlan(plan.assignments, input.event, input.schedule);
          plan.metrics = metrics;
          plan.solverTrace = { ...plan.solverTrace, workload };
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

  // Insertion runs whenever the sidecar produced nothing usable. Only a real
  // timeout or an unreachable sidecar is reported as timedOut; an infeasible
  // verdict is not, so a failed insertion then reads as no legal plan.
  const fallback = proposeInsertion(input);
  // Stage A finding nobody legal is a proof, whoever would have solved it:
  // no solver can place a job that no technician may take.
  const proven = fallback.plans.length === 0 && fallback.message === 'no_eligible_technicians';
  return {
    ...fallback,
    timedOut: !answered && !proven,
    message: fallback.message ?? (sidecarMessage ? `sidecar_${sidecarMessage}` : undefined),
  };
}

function proposeInsertion(input: ProposeInput): ProposeOutput {
  const { event, schedule, profile } = input;

  // Extract certs, shifts, and jobRequirements from schedule or default to EASTWIND fixture
  const certs: TechnicianCert[] = (schedule as unknown as { certs?: TechnicianCert[] }).certs || EASTWIND.certs;
  const shifts: Shift[] = (schedule as unknown as { shifts?: Shift[] }).shifts || EASTWIND.shifts;
  const requirements: JobRequirement[] =
    (schedule as unknown as { jobRequirements?: JobRequirement[] }).jobRequirements || EASTWIND.jobRequirements;

  if (event.type === 'technician_unavailable' || event.type === 'job_overrun') {
    const plans = (['sla_first', 'minimal_disruption'] as const)
      .map((planProfile) =>
        event.type === 'technician_unavailable'
          ? unavailableFallback(input, planProfile, certs, shifts, requirements)
          : overrunFallback(input, planProfile, certs, shifts, requirements),
      )
      .filter((plan): plan is CandidatePlan => plan !== null);

    if (plans.length === 0) {
      return { plans: [], engine: 'insertion', timedOut: false, message: 'no_legal_technician' };
    }
    const activeProfilePlan = plans.find((p) => p.profile === profile) || plans[0];
    if (activeProfilePlan) {
      activeProfilePlan.status = 'RECOMMENDED';
    }
    return { plans, engine: 'insertion', timedOut: false };
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
    const candidate = generateCandidateForProfile(input, jobToPlan, eligibleTechs, planProfile);

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

/** Mirrors validate.ts: maxMinutesDay, plus 120 when the technician accepts overtime. */
const OT_ALLOWANCE_MINUTES = 120;

function jobsById(schedule: ProposeInput['schedule']): Map<string, Job> {
  return new Map((schedule.jobs ?? []).map((j) => [j.id, j]));
}

function isStarted(job: Job | undefined): boolean {
  return job?.lockState === 'in_progress' || job?.status === 'on_site';
}

function liveSlots(schedule: ProposeInput['schedule']): PlannedSlot[] {
  return (schedule.assignments ?? [])
    .filter((a) => a.status === 'accepted' || a.status === 'offered')
    .map((a) => ({
      jobId: a.jobId,
      technicianId: a.technicianId,
      windowStart: a.windowStart,
      windowEnd: a.windowEnd,
      travelBeforeMinutes: a.travelBeforeMinutes,
    }));
}

/**
 * Whether `tech` can take `jobId` from `start` to `end` on top of `slots`,
 * by the rules validatePlan applies: no overlap, a real drive between
 * consecutive jobs, not before clock-in, and within the day ceiling. The
 * fallback used to check only the gap after a technician's last job.
 */
function fits(
  tech: Technician,
  jobId: string,
  start: string,
  end: string,
  slots: readonly PlannedSlot[],
  schedule: ProposeInput['schedule'],
): boolean {
  const sites = schedule.sites ?? EASTWIND.sites;
  const matrix = schedule.travel?.length ? schedule.travel : EASTWIND.travel;
  const jobs = new Map((schedule.jobs ?? []).map((j) => [j.id, j]));
  const cluster = (id: string) => {
    const job = jobs.get(id);
    return job ? clusterForJob(job, sites) : 'cbd';
  };
  const begins = Date.parse(start);
  const ends = Date.parse(end);
  if (!Number.isFinite(begins) || !Number.isFinite(ends)) return false;

  const shift = (schedule.shifts ?? EASTWIND.shifts).find(
    (s) => s.technicianId === tech.id && s.shiftDate === schedule.date,
  );
  if (shift && !withinShift(shift, start, end)) return false;

  const mine = slots.filter((s) => s.technicianId === tech.id && s.jobId !== jobId);
  for (const other of mine) {
    const oStart = Date.parse(other.windowStart ?? '');
    const oEnd = Date.parse(other.windowEnd ?? '');
    if (!Number.isFinite(oStart) || !Number.isFinite(oEnd)) continue;
    if (oEnd <= begins) {
      if (oEnd + safeTravel(cluster(other.jobId), cluster(jobId), matrix) * 60000 > begins) return false;
    } else if (oStart >= ends) {
      if (ends + safeTravel(cluster(jobId), cluster(other.jobId), matrix) * 60000 > oStart) return false;
    } else {
      return false;
    }
  }

  const worked = mine.reduce((total, s) => total + minutesBetween(s.windowStart, s.windowEnd), 0);
  const ceiling = (tech.maxMinutesDay || 480) + (tech.acceptsOt ? OT_ALLOWANCE_MINUTES : 0);
  return worked + minutesBetween(start, end) <= ceiling;
}

/**
 * The solver's costs, so a fallback plan makes the same trade the sidecar
 * would. Mirrors services/optimizer/app.py: sla_first pays 5 per drive minute
 * and 6 per point of workload gap; minimal_disruption pays 300 for each
 * colleague it disturbs, the receiver's load pressure, 1 per drive minute and
 * 5 per point of gap.
 */
const FALLBACK_COST = {
  sla_first: { drive: 5, gap: 6, disturbed: 0 },
  minimal_disruption: { drive: 1, gap: 5, disturbed: 300 },
} as const;

/**
 * Hand one slot to the best legal technician for this profile, or null when
 * nobody can take it. Each option is measured as a whole plan, not guessed.
 */
function reassignSlot(
  input: ProposeInput,
  profile: PlanProfile,
  slots: PlannedSlot[],
  index: number,
  eligible: Technician[],
): PlannedSlot[] | null {
  const slot = slots[index]!;
  const cost = FALLBACK_COST[profile];
  const live = new Map(liveSlots(input.schedule).map((s) => [s.jobId, s.technicianId]));
  const disturbed = new Set(
    slots.filter((s) => live.has(s.jobId) && live.get(s.jobId) !== s.technicianId).map((s) => s.technicianId),
  );
  const job = (input.schedule.jobs ?? []).find((j) => j.id === slot.jobId);
  const options = eligible
    .filter((t) => t.id !== slot.technicianId)
    .map((t) => {
      // The customer's booked time if this technician is free then; otherwise
      // the earliest time inside their window that fits.
      if (fits(t, slot.jobId, slot.windowStart ?? '', slot.windowEnd ?? '', slots, input.schedule)) {
        return { t, windowStart: slot.windowStart, windowEnd: slot.windowEnd };
      }
      const later = job ? earliestFit(t, job, slots, input.schedule) : null;
      return later ? { t, ...later } : null;
    })
    .filter((o): o is { t: Technician; windowStart: string | undefined; windowEnd: string | undefined } => o !== null)
    .map(({ t, windowStart, windowEnd }) => {
      const next = slots.map((s, i) => (i === index ? { ...s, technicianId: t.id, windowStart, windowEnd } : s));
      const { metrics } = measurePlan(next, input.event, input.schedule);
      const booked = slots
        .filter((s) => s.technicianId === t.id)
        .reduce((total, s) => total + minutesBetween(s.windowStart, s.windowEnd), 0);
      const load = ((booked + minutesBetween(slot.windowStart, slot.windowEnd)) * 100) / (t.maxMinutesDay || 480);
      const pressure = profile === 'minimal_disruption' ? Math.round(t.acceptsOt ? load : load * 1.25) : 0;
      const score =
        cost.drive * metrics.travelMinutes +
        cost.gap * (metrics.workloadSpreadPct ?? 0) +
        (disturbed.has(t.id) ? 0 : cost.disturbed) +
        pressure;
      return { tech: t, next, score };
    })
    .sort((a, b) => a.score - b.score || a.tech.id.localeCompare(b.tech.id));
  return options[0]?.next ?? null;
}

function stageAEligible(
  job: Job,
  schedule: ProposeInput['schedule'],
  exclude: string | undefined,
  certs: TechnicianCert[],
  shifts: Shift[],
  requirements: JobRequirement[],
): Technician[] {
  const pool = (schedule.technicians ?? []).filter((t) => t.isActive && t.id !== exclude);
  return stageA(job, pool, certs, shifts, requirements)
    .filter((r) => r.isEligible)
    .map((r) => r.technician);
}

/**
 * Sick technician, insertion fallback: each of their unstarted jobs keeps its
 * customer's time and goes to a legal colleague who can reach it. When nobody
 * can, there is no plan. Handing it to an ineligible technician, as this used
 * to, only produced a candidate for the validator to refuse.
 */
function unavailableFallback(
  input: ProposeInput,
  profile: PlanProfile,
  certs: TechnicianCert[],
  shifts: Shift[],
  requirements: JobRequirement[],
): CandidatePlan | null {
  const { event, schedule } = input;
  const unavailableTechId = (event.normalizedPayload.technicianId as string) || event.affectedIds[0];
  const jobs = new Map((schedule.jobs ?? []).map((j) => [j.id, j]));
  let slots = liveSlots(schedule);

  // All day: every unstarted job. Part of the day: only the ones the cut
  // shift no longer covers; the rest stay where they are.
  const shift = (schedule.shifts ?? []).find(
    (s) => s.technicianId === unavailableTechId && s.shiftDate === schedule.date,
  );
  const toReplan = slots
    .filter((s) => s.technicianId === unavailableTechId && !isStarted(jobs.get(s.jobId)))
    .filter((s) => !shift || !withinShift(shift, s.windowStart ?? '', s.windowEnd ?? ''))
    .sort((a, b) => Date.parse(a.windowStart ?? '') - Date.parse(b.windowStart ?? ''))
    .map((s) => s.jobId);

  for (const jobId of toReplan) {
    const job = jobs.get(jobId);
    if (!job) return null;
    const eligible = stageAEligible(job, schedule, unavailableTechId, certs, shifts, requirements);
    const next = reassignSlot(input, profile, slots, slots.findIndex((s) => s.jobId === jobId), eligible);
    if (!next) return null;
    slots = next;
  }

  return finishFallbackPlan(input, profile, slots, `unavailable_${unavailableTechId}`, []);
}

/**
 * Overrun, insertion fallback: the job's end moves, then that technician's
 * later jobs are walked in order. A job that still fits after the drive stays.
 * One that collides is retimed (minimal_disruption: same technician) or handed
 * to a colleague at the customer's booked time (sla_first), falling back to
 * the other when the preferred move is not legal.
 */
function overrunFallback(
  input: ProposeInput,
  profile: PlanProfile,
  certs: TechnicianCert[],
  shifts: Shift[],
  requirements: JobRequirement[],
): CandidatePlan | null {
  const { event, schedule } = input;
  const overrunJobId = (event.normalizedPayload.jobId as string) || event.affectedIds[0];
  const overrunMinutes = Number(event.normalizedPayload.overrunMinutes || 45);
  if (!overrunJobId || !jobsById(schedule).has(overrunJobId)) return null;
  const sites = schedule.sites ?? EASTWIND.sites;
  const matrix = schedule.travel?.length ? schedule.travel : EASTWIND.travel;
  const jobs = new Map((schedule.jobs ?? []).map((j) => [j.id, j]));
  const techs = new Map((schedule.technicians ?? []).map((t) => [t.id, t]));
  let slots = liveSlots(schedule);

  const overrunIndex = slots.findIndex((s) => s.jobId === overrunJobId);
  const overrun = slots[overrunIndex];
  if (!overrun?.windowEnd || !overrun.windowStart) return null;
  const owner = overrun.technicianId;
  slots[overrunIndex] = { ...overrun, windowEnd: toSgIso(Date.parse(overrun.windowEnd) + overrunMinutes * 60000) };

  let cursor = Date.parse(slots[overrunIndex]!.windowEnd!);
  let cursorCluster = clusterForJob(jobs.get(overrunJobId)!, sites);
  const later = slots
    .filter((s) => s.technicianId === owner && s.jobId !== overrunJobId)
    .filter((s) => Date.parse(s.windowStart ?? '') >= Date.parse(overrun.windowStart!))
    .filter((s) => !isStarted(jobs.get(s.jobId)))
    .sort((a, b) => Date.parse(a.windowStart ?? '') - Date.parse(b.windowStart ?? ''));

  for (const booked of later) {
    const job = jobs.get(booked.jobId);
    if (!job) return null;
    const here = clusterForJob(job, sites);
    const earliest = cursor + safeTravel(cursorCluster, here, matrix) * 60000;
    const bookedStart = Date.parse(booked.windowStart ?? '');
    if (bookedStart >= earliest) {
      cursor = Date.parse(booked.windowEnd ?? '');
      cursorCluster = here;
      continue;
    }

    const index = slots.findIndex((s) => s.jobId === booked.jobId);
    const duration = Date.parse(booked.windowEnd ?? '') - bookedStart;
    const retimed = { ...booked, windowStart: toSgIso(earliest), windowEnd: toSgIso(earliest + duration) };
    const retimeOk =
      job.lockState !== 'promised' &&
      (!job.windowEnd || earliest + duration <= Date.parse(job.windowEnd)) &&
      fits(techs.get(owner)!, booked.jobId, retimed.windowStart, retimed.windowEnd, slots, schedule);
    const retime = () => slots.map((s, i) => (i === index ? retimed : s));
    const reassign = () =>
      job.lockState === 'promised'
        ? null
        : reassignSlot(input, profile, slots, index,
            stageAEligible(job, schedule, owner, certs, shifts, requirements));

    const next =
      profile === 'sla_first'
        ? reassign() ?? (retimeOk ? retime() : null)
        : (retimeOk ? retime() : null) ?? reassign();
    if (!next) return null;
    slots = next;
    const kept = slots[index]!;
    if (kept.technicianId === owner) {
      cursor = Date.parse(kept.windowEnd ?? '');
      cursorCluster = here;
    }
  }

  return finishFallbackPlan(input, profile, slots, `overrun_${overrunJobId}`, [
    { action: 'extend_duration', jobId: overrunJobId, overrunMinutes },
  ]);
}

/** Measure, describe and validate a fallback plan the same way as every other. */
function finishFallbackPlan(
  input: ProposeInput,
  profile: PlanProfile,
  slots: PlannedSlot[],
  idSuffix: string,
  leadingChanges: Record<string, unknown>[],
): CandidatePlan {
  const { event, schedule } = input;
  const live = new Map(liveSlots(schedule).map((s) => [s.jobId, s]));
  const { metrics, workload, travelBefore } = measurePlan(slots, event, schedule);
  const overrunJobId = event.type === 'job_overrun'
    ? ((event.normalizedPayload.jobId as string) || event.affectedIds[0])
    : undefined;

  const changeSet = [...leadingChanges];
  const assignments = slots.map((slot) => {
    const before = live.get(slot.jobId);
    if (!slotChanged(slot, before)) return slot;
    if (slot.jobId !== overrunJobId) {
      changeSet.push({
        action: !before ? 'assign' : before.technicianId !== slot.technicianId ? 'reassign' : 'retime',
        jobId: slot.jobId,
        fromTechnicianId: before?.technicianId ?? null,
        technicianId: slot.technicianId,
        windowStart: slot.windowStart,
        windowEnd: slot.windowEnd,
      });
    }
    return { ...slot, travelBeforeMinutes: travelBefore.get(slot.jobId) ?? slot.travelBeforeMinutes };
  });

  const plan: CandidatePlan = {
    id: `plan_${profile}_${idSuffix}`,
    proposalId: event.id,
    sourceSnapshotId: event.sourceSnapshotId || schedule.snapshotId,
    profile,
    assignments,
    changeSet,
    metrics,
    validations: { ok: true, violations: [] },
    solverTrace: {
      engine: 'insertion',
      objective: profile === 'sla_first' ? 'soonest_service' : 'least_knock_on',
      workload,
    },
    timedOut: false,
    durationMs: 15,
    status: 'VALIDATED',
    createdAt: `${schedule.date || EASTWIND_DATE}T08:00:00+08:00`,
  };
  plan.validations = validatePlan(plan, schedule);
  return plan;
}


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
 * How much of this technician's day the job consumes, as a percentage of their
 * ceiling. Someone who does not accept overtime and is already two thirds full
 * is where a late-running job turns into tomorrow's problem, so this is the
 * honest reading of "disruption" for an engine that never moves existing work.
 */
function loadPressure(technician: Technician, slot: PlannedSlot, liveAssignments: Assignment[]): number {
  const duration = minutesBetween(slot.windowStart, slot.windowEnd);
  const after =
    committedMinutes(technician.id, liveAssignments) + duration + (slot.travelBeforeMinutes ?? 0);
  const ceiling = technician.maxMinutesDay || 480;
  const utilisation = (after / ceiling) * 100;
  return technician.acceptsOt ? utilisation : utilisation * 1.25;
}

interface ScoredCandidate {
  technician: Technician;
  slot: PlannedSlot;
  assignments: PlannedSlot[];
  metrics: PlanMetrics;
  workload: TechnicianWorkload[];
  pressure: number;
  blended: number;
}

/**
 * The profiles have to be separated by what they optimise, not only by weights.
 *
 * With a pure insertion into a free window, slaLateness, overtime and jobsMoved
 * are all genuinely zero for every candidate. A weighted sum over near-equal
 * weights makes the profiles arithmetically the same and both plans land on
 * the same technician, which is what the deployed box once showed.
 *
 * So each profile leads with its own objective and falls back to the weighted
 * blend only to break ties:
 *
 *   sla_first           soonest on site: lateness, then travel, then balance
 *   minimal_disruption  least knock-on: jobs moved, then balance, then load pressure
 *
 * Balance is the board-wide workload gap after the job lands, so a busy
 * technician is not handed more while a colleague sits idle.
 */
function rank(profile: PlanProfile, a: ScoredCandidate, b: ScoredCandidate): number {
  const spread = (c: ScoredCandidate) => c.metrics.workloadSpreadPct ?? 0;
  if (profile === 'sla_first') {
    if (a.metrics.slaLatenessMinutes !== b.metrics.slaLatenessMinutes) {
      return a.metrics.slaLatenessMinutes - b.metrics.slaLatenessMinutes;
    }
    const onSite = (c: ScoredCandidate) => Date.parse(c.slot.windowStart ?? '') || 0;
    if (onSite(a) !== onSite(b)) return onSite(a) - onSite(b);
    if (a.metrics.travelMinutes !== b.metrics.travelMinutes) {
      return a.metrics.travelMinutes - b.metrics.travelMinutes;
    }
    if (spread(a) !== spread(b)) return spread(a) - spread(b);
  } else {
    if (a.metrics.jobsMoved !== b.metrics.jobsMoved) {
      return a.metrics.jobsMoved - b.metrics.jobsMoved;
    }
    if (spread(a) !== spread(b)) return spread(a) - spread(b);
    if (a.pressure !== b.pressure) return a.pressure - b.pressure;
  }
  if (a.blended !== b.blended) return a.blended - b.blended;
  return a.technician.id.localeCompare(b.technician.id);
}

/** Step between start times tried inside a customer's window. */
const START_STEP_MINUTES = 15;

function earliestFit(
  tech: Technician,
  job: Job,
  slots: readonly PlannedSlot[],
  schedule: ProposeInput['schedule'],
): { windowStart: string; windowEnd: string } | null {
  const opens = Date.parse(job.windowStart ?? '');
  if (!Number.isFinite(opens)) return null;
  const durationMs = (job.durationMinutes || 90) * 60000;
  const closes = job.windowEnd ? Date.parse(job.windowEnd) : opens + durationMs;
  for (let start = opens; start + durationMs <= closes; start += START_STEP_MINUTES * 60000) {
    const windowStart = start === opens ? job.windowStart! : toSgIso(start);
    const windowEnd = toSgIso(start + durationMs);
    if (fits(tech, job.id, windowStart, windowEnd, slots, schedule)) return { windowStart, windowEnd };
  }
  return null;
}

function generateCandidateForProfile(
  input: ProposeInput,
  targetJob: Job,
  eligibleTechs: Technician[],
  profile: PlanProfile,
): CandidatePlan | null {
  const { event, schedule } = input;
  const weights = PLAN_WEIGHTS[profile];
  const liveAssignments = (schedule.assignments ?? []).filter(
    (a) => a.status === 'accepted' || a.status === 'offered',
  );
  const live = liveSlots(schedule);

  const scored: ScoredCandidate[] = [];

  for (const tech of eligibleTechs) {
    const techAssignments = liveAssignments.filter((a) => a.technicianId === tech.id);

    let windowStart = targetJob.windowStart;
    let windowEnd = targetJob.windowEnd;

    if (targetJob.windowStart) {
      // The earliest start inside the customer's window at which this
      // technician is actually free, after the drive from their previous job.
      // Placing every candidate at the window's opening offered a technician
      // still busy on another job, which the validator then refused.
      const slot = earliestFit(tech, targetJob, live, schedule);
      if (!slot) continue;
      windowStart = slot.windowStart;
      windowEnd = slot.windowEnd;
    } else {
      let startHour = 9;
      if (techAssignments.length > 0) {
        startHour = Math.min(17, 9 + techAssignments.length * 2);
      }
      windowStart = `${schedule.date || EASTWIND_DATE}T${String(startHour).padStart(2, '0')}:00:00+08:00`;
      const endHour = Math.min(18, startHour + 1);
      windowEnd = `${schedule.date || EASTWIND_DATE}T${String(endHour).padStart(2, '0')}:30:00+08:00`;
    }

    // Measured as a whole plan: the drive into the job is from wherever this
    // technician was before it, and the travel metric is what the fleet's day
    // gains, including any change to the drive to their next job.
    const assignments: PlannedSlot[] = [
      { jobId: targetJob.id, technicianId: tech.id, windowStart, windowEnd },
      // The job is being placed, so any booking it already has is replaced.
      ...live.filter((s) => s.jobId !== targetJob.id),
    ];
    const { metrics, workload, travelBefore } = measurePlan(assignments, event, schedule);
    const slot: PlannedSlot = { ...assignments[0]!, travelBeforeMinutes: travelBefore.get(targetJob.id) };
    assignments[0] = slot;

    const pressure = loadPressure(tech, slot, liveAssignments);
    const blended =
      weights.slaLateness * metrics.slaLatenessMinutes +
      weights.travel * metrics.travelMinutes +
      weights.overtime * metrics.overtimeMinutes +
      weights.disruption * metrics.jobsMoved * 20 +
      weights.imbalance * (metrics.workloadSpreadPct ?? 0);

    scored.push({ technician: tech, slot, assignments, metrics, workload, pressure, blended });
  }

  if (scored.length === 0) return null;

  scored.sort((a, b) => rank(profile, a, b));
  const best = scored[0]!;

  const plan: CandidatePlan = {
    id: `plan_${profile}_${targetJob.id}`,
    proposalId: event.id,
    sourceSnapshotId: event.sourceSnapshotId || schedule.snapshotId,
    profile,
    assignments: best.assignments,
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
      workload: best.workload,
      considered: scored.map((c) => ({
        technicianId: c.technician.id,
        travelMinutes: c.metrics.travelMinutes,
        overtimeMinutes: c.metrics.overtimeMinutes,
        loadPressure: Math.round(c.pressure),
        workloadSpreadPct: c.metrics.workloadSpreadPct,
      })),
    },
    timedOut: false,
    durationMs: 15,
    status: 'VALIDATED',
    createdAt: `${schedule.date || EASTWIND_DATE}T08:00:00+08:00`,
  };

  // Run independent hard-constraint validator
  plan.validations = validatePlan(plan, schedule);

  return plan;
}
