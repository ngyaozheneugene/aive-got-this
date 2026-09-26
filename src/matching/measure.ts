import { travelMinutes } from '../location/matrix';
import { EASTWIND } from '../shared/fixtures/eastwind';
import type {
  Assignment,
  OperationalEvent,
  PlannedSlot,
  PlanMetrics,
  ProposeInput,
  Site,
  Technician,
  TravelMatrix,
} from '../shared/types/domain';

/**
 * One measurement for every candidate plan, whichever engine produced it.
 *
 * The insertion fallbacks used to report constants (30 minutes of driving,
 * overtime equal to the overrun, two customers), and the sidecar measured in
 * Python with its own definitions. The desk compared those numbers as if they
 * meant the same thing. Every plan is now measured here, from the slots it
 * actually proposes, against the live board it would replace.
 */

/** Fallback when the travel matrix has no row for a pair. Mirrors the sidecar. */
export const UNKNOWN_TRAVEL_MINUTES = 45;

export interface TechnicianWorkload {
  technicianId: string;
  minutes: number;
  utilisationPct: number;
}

export interface PlanMeasurement {
  metrics: PlanMetrics;
  workload: TechnicianWorkload[];
  /** Drive into each slot from wherever that technician was before it. */
  travelBefore: Map<string, number>;
}

type Schedule = ProposeInput['schedule'];

function isLive(a: Pick<Assignment, 'status'>): boolean {
  return a.status === 'accepted' || a.status === 'offered';
}

function minutesBetween(start?: string, end?: string): number {
  if (!start || !end) return 0;
  const span = Date.parse(end) - Date.parse(start);
  return Number.isFinite(span) && span > 0 ? Math.round(span / 60000) : 0;
}

function safeTravel(from: string, to: string, matrix: TravelMatrix[]): number {
  try {
    return travelMinutes(from, to, matrix);
  } catch {
    return UNKNOWN_TRAVEL_MINUTES;
  }
}

function originOf(tech: Technician | undefined): string {
  return tech?.currentCluster || tech?.homeRegion || 'cbd';
}

/**
 * Drive into every slot, following each technician's day in start order from
 * where they began it. This is the route the validator checks, so a plan that
 * chains two Bedok jobs pays one drive to Bedok, not two.
 */
export function routeTravel(slots: readonly PlannedSlot[], schedule: Schedule): Map<string, number> {
  const sites: Site[] = schedule.sites ?? EASTWIND.sites;
  const matrix: TravelMatrix[] = schedule.travel?.length ? schedule.travel : EASTWIND.travel;
  const clusterOf = new Map(
    (schedule.jobs ?? []).map((j) => [j.id, sites.find((s) => s.id === j.siteId)?.estateCluster ?? 'cbd']),
  );
  const techs = new Map((schedule.technicians ?? []).map((t) => [t.id, t]));

  const byTech = new Map<string, PlannedSlot[]>();
  for (const slot of slots) {
    const rows = byTech.get(slot.technicianId) ?? [];
    rows.push(slot);
    byTech.set(slot.technicianId, rows);
  }

  const drive = new Map<string, number>();
  for (const [techId, rows] of byTech) {
    rows.sort((a, b) => Date.parse(a.windowStart ?? '') - Date.parse(b.windowStart ?? ''));
    let previous = originOf(techs.get(techId));
    for (const slot of rows) {
      const here = clusterOf.get(slot.jobId) ?? 'cbd';
      drive.set(slot.jobId, safeTravel(previous, here, matrix));
      previous = here;
    }
  }
  return drive;
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Jobs the event puts in play: the ones a plan is accountable for placing. */
function jobsInPlay(event: OperationalEvent, live: Assignment[]): string[] {
  const payload = event.normalizedPayload ?? {};
  if (event.type === 'urgent_job') {
    const target = (payload.jobId as string) || event.affectedIds[0];
    return target ? [target] : [];
  }
  if (event.type === 'technician_unavailable') {
    const techId = (payload.technicianId as string) || event.affectedIds[0];
    return live.filter((a) => a.technicianId === techId).map((a) => a.jobId);
  }
  if (event.type === 'job_overrun') {
    const jobId = (payload.jobId as string) || event.affectedIds[0];
    const owner = live.find((a) => a.jobId === jobId)?.technicianId;
    return live.filter((a) => a.technicianId === owner).map((a) => a.jobId);
  }
  return [];
}

/**
 * Who is working today and so counts toward balance: active, not the
 * technician the event took off the board, and on shift when shifts are known.
 */
function workingTechnicians(event: OperationalEvent, schedule: Schedule): Technician[] {
  const unavailable =
    event.type === 'technician_unavailable'
      ? ((event.normalizedPayload?.technicianId as string) || event.affectedIds[0])
      : undefined;
  const shifts = schedule.shifts;
  const onShift = shifts?.length
    ? new Set(
        shifts
          .filter((s) => s.shiftDate === schedule.date && (s.status === 'clocked_in' || s.status === 'scheduled'))
          .map((s) => s.technicianId),
      )
    : undefined;
  return (schedule.technicians ?? []).filter(
    (t) => t.isActive && t.id !== unavailable && (!onShift || onShift.has(t.id)),
  );
}

/**
 * Each working technician's booked minutes as a share of their day ceiling.
 * The spread between the busiest and the idlest is the balance metric: a plan
 * that piles the new job on someone already at 90% while a colleague sits at
 * 25% scores worse than one that evens them out.
 */
export function workloadOf(
  slots: readonly PlannedSlot[],
  event: OperationalEvent,
  schedule: Schedule,
): { workload: TechnicianWorkload[]; spreadPct: number } {
  const workload = workingTechnicians(event, schedule).map((t) => {
    const minutes = sum(
      slots.filter((s) => s.technicianId === t.id).map((s) => minutesBetween(s.windowStart, s.windowEnd)),
    );
    const ceiling = t.maxMinutesDay || 480;
    return { technicianId: t.id, minutes, utilisationPct: Math.round((minutes / ceiling) * 100) };
  });
  if (workload.length === 0) return { workload, spreadPct: 0 };
  const pcts = workload.map((w) => w.utilisationPct);
  return { workload, spreadPct: Math.max(...pcts) - Math.min(...pcts) };
}

/**
 * Measure a plan against the live board it would replace.
 *
 *   slaLatenessMinutes  minutes any job finishes past its customer window
 *   travelMinutes       fleet driving the plan adds (negative when it saves some)
 *   overtimeMinutes     minutes any technician works past their day ceiling
 *   jobsMoved           booked jobs given a new technician or time; an
 *                       overrunning job's own extension is the event, not a move
 *   customersAffected   customers whose job is new, moved or overrunning
 *   unassignedCount     jobs the event put in play that the plan leaves unplaced
 *   workloadSpreadPct   busiest minus idlest working technician, % of their day
 */
export function measurePlan(
  slots: readonly PlannedSlot[],
  event: OperationalEvent,
  schedule: Schedule,
): PlanMeasurement {
  const live = (schedule.assignments ?? []).filter(isLive);
  const liveByJob = new Map(live.map((a) => [a.jobId, a]));
  const jobs = new Map((schedule.jobs ?? []).map((j) => [j.id, j]));
  const techs = new Map((schedule.technicians ?? []).map((t) => [t.id, t]));
  const overrunJob =
    event.type === 'job_overrun' ? ((event.normalizedPayload?.jobId as string) || event.affectedIds[0]) : undefined;

  const changed = slots.filter((slot) => {
    const before = liveByJob.get(slot.jobId);
    return (
      !before ||
      before.technicianId !== slot.technicianId ||
      before.windowStart !== slot.windowStart ||
      before.windowEnd !== slot.windowEnd
    );
  });
  const moved = changed.filter((s) => liveByJob.has(s.jobId) && s.jobId !== overrunJob);
  const customers = new Set(
    changed.map((s) => jobs.get(s.jobId)?.customerId).filter((c): c is string => Boolean(c)),
  );

  const planned = routeTravel(slots, schedule);
  const baseline = routeTravel(live, schedule);
  const travelMinutes = sum(planned.values()) - sum(baseline.values());

  let slaLatenessMinutes = 0;
  const worked = new Map<string, number>();
  for (const slot of slots) {
    const promised = jobs.get(slot.jobId)?.windowEnd;
    const ends = slot.windowEnd ? Date.parse(slot.windowEnd) : NaN;
    if (promised && Number.isFinite(ends) && ends > Date.parse(promised)) {
      slaLatenessMinutes += Math.round((ends - Date.parse(promised)) / 60000);
    }
    worked.set(
      slot.technicianId,
      (worked.get(slot.technicianId) ?? 0) + minutesBetween(slot.windowStart, slot.windowEnd),
    );
  }
  let overtimeMinutes = 0;
  for (const [techId, minutes] of worked) {
    overtimeMinutes += Math.max(0, minutes - (techs.get(techId)?.maxMinutesDay || 480));
  }

  const placed = new Set(slots.map((s) => s.jobId));
  const unassignedCount = jobsInPlay(event, live).filter((id) => !placed.has(id)).length;
  const { workload, spreadPct } = workloadOf(slots, event, schedule);

  return {
    metrics: {
      slaLatenessMinutes,
      travelMinutes,
      overtimeMinutes,
      jobsMoved: moved.length,
      customersAffected: customers.size,
      unassignedCount,
      workloadSpreadPct: spreadPct,
    },
    workload,
    travelBefore: planned,
  };
}
