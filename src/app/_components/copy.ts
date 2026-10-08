// Plain-language wording for the desk. The people using the desk schedule
// technicians; they do not read profile ids, reason codes or snapshot
// versions. JSX-free so the wording is unit tested without a DOM.
//
// Everything here describes numbers the backend already stored. The desk
// does not score plans; it only puts stored metrics and slots into words.
import type {
  CandidatePlan, DeskBoard, OperationalEventStatus, PlanMetrics, PlanProfile, RiskLevel,
} from '../../shared/types/domain';
import { clock } from './geo';
import { buildScheduleView } from './schedule-view';

export interface ProfileCopy {
  name: string;
  /** What the plan optimises for, in one line. */
  promise: string;
  /** When a coordinator should pick it. */
  pickWhen: string;
}

export const PROFILE_COPY: Record<PlanProfile, ProfileCopy> = {
  sla_first: {
    name: 'On-time first',
    promise: 'Gets the job done inside the promised window and spreads the work so nobody is overloaded, even if it means more driving.',
    pickWhen: 'Pick this when the customer is waiting or has a service agreement.',
  },
  minimal_disruption: {
    name: 'Least disruption',
    promise: 'Changes as few people’s days as possible, giving the work to whoever has room.',
    pickWhen: 'Pick this when the job can take a little longer and the team is stretched.',
  },
};

export function profileName(profile: string): string {
  return PROFILE_COPY[profile as PlanProfile]?.name ?? profile;
}

export const METRIC_COPY: Record<keyof PlanMetrics, { label: string; unit?: string; help: string }> = {
  slaLatenessMinutes: { label: 'Late for promised window', unit: 'min', help: 'How late jobs finish past what the customer was promised.' },
  travelMinutes: { label: 'Driving time', unit: 'min', help: 'Driving this plan adds across the team, from the travel-time table. Negative means it saves driving.' },
  overtimeMinutes: { label: 'Overtime', unit: 'min', help: 'Work past the end of a technician’s shift.' },
  jobsMoved: { label: 'Other jobs moved', help: 'Existing jobs that get a new time or technician.' },
  customersAffected: { label: 'Customers to update', help: 'Customers who should hear about a change.' },
  unassignedCount: { label: 'Jobs still without a technician', help: 'Jobs this plan could not place.' },
  workloadSpreadPct: {
    label: 'Workload gap',
    unit: '%',
    help: 'Busiest technician minus least busy, as a share of their working day. Lower means a more even day.',
  },
};

/** Lower is better for every stored metric. */
const METRIC_ORDER: Array<keyof PlanMetrics> = [
  'slaLatenessMinutes',
  'unassignedCount',
  'travelMinutes',
  'jobsMoved',
  'overtimeMinutes',
  'workloadSpreadPct',
  'customersAffected',
];

export function riskCopy(risk: RiskLevel | string): { label: string; detail: string; tone: 'success' | 'warning' | 'danger' } {
  if (risk === 'high') {
    return { label: 'High impact', detail: 'This moves customer promises. Check it carefully before approving.', tone: 'danger' };
  }
  if (risk === 'medium') {
    return { label: 'Needs your approval', detail: 'This gives a technician new work, so a person signs it off.', tone: 'warning' };
  }
  return { label: 'Low impact', detail: 'A small change. Still yours to approve.', tone: 'success' };
}

/** One sentence per job the plan changes, e.g. "Siti takes Raffles Place Capital, 13:00–14:30". */
export function describeChanges(board: DeskBoard, plan: CandidatePlan): string[] {
  const names = new Map(board.technicians.map((t) => [t.technician.id, t.technician.name]));
  const name = (id: string) => names.get(id) ?? 'A technician';
  return buildScheduleView(board, plan)
    .slots.filter((s) => s.change !== 'unchanged')
    .map((s) => {
      const who = name(s.technicianId);
      const what = s.row.customer.name;
      const when = `${clock(s.start)}–${clock(s.end)}`;
      const drive = s.travelBeforeMinutes ? ` · ${s.travelBeforeMinutes} min drive` : '';
      if (s.change === 'added') return `${who} takes ${what}, ${when}${drive}`;
      if (s.change === 'reassigned') return `${what} moves from ${name(s.previous!.technicianId)} to ${who}, ${when}${drive}`;
      return `${what} (${who}) moves to ${when}`;
    });
}

const CALL_REASON = {
  promised: 'its window was promised to',
  no_legal_technician: 'nobody else is qualified to take it from',
  no_time: 'nobody qualified has time for it instead of',
} as const;

/**
 * Jobs the plan leaves for a call (partial coverage), one sentence each:
 * "Call Northpoint Medical: 14:00–15:30 has no technician (its window was promised to Mei)".
 */
export function describeLeftForCall(board: DeskBoard, plan: CandidatePlan): string[] {
  const names = new Map(board.technicians.map((t) => [t.technician.id, t.technician.name]));
  return buildScheduleView(board, plan).leftForCall.map(({ row, reason, previous }) => {
    const when = previous ? `${clock(previous.start)}–${clock(previous.end)}` : 'their booking';
    const who = previous ? names.get(previous.technicianId) ?? 'their technician' : 'their technician';
    return `Call ${row.customer.name}: ${when} has no technician (${CALL_REASON[reason]} ${who})`;
  });
}

const WAITING_REASON: Record<string, string> = {
  no_legal_technician: 'nobody on the team is qualified for it',
  no_time: 'no qualified technician is free inside its window',
  window_too_short: 'its window is shorter than the job',
};

/**
 * Waiting jobs a "place all" plan could not place (ADR 014), one sentence each:
 * "Far East Medical (08:30–11:30) stays waiting: no qualified technician is free inside its window".
 */
export function describeLeftWaiting(board: DeskBoard, plan: CandidatePlan): string[] {
  const rows = new Map(board.jobs.map((r) => [r.job.id, r]));
  return (plan.changeSet ?? [])
    .filter((c) => c.action === 'leave_waiting' && typeof c.jobId === 'string')
    .map((c) => {
      const row = rows.get(c.jobId as string);
      const when = row?.job.windowStart && row.job.windowEnd ? ` (${row.job.windowStart.slice(11, 16)}–${row.job.windowEnd.slice(11, 16)})` : '';
      return `${row?.customer.name ?? 'A job'}${when} stays waiting: ${WAITING_REASON[String(c.reason)] ?? 'it could not be placed'}`;
    });
}

/**
 * How busy each technician the plan gives new work to already is, from the
 * board's stored load: "Jonah already has 90 min of work booked today".
 */
export function workloadNotes(board: DeskBoard, plan: CandidatePlan): string[] {
  const rows = new Map(board.technicians.map((t) => [t.technician.id, t]));
  const receiving = new Set(
    buildScheduleView(board, plan)
      .slots.filter((s) => s.change === 'added' || s.change === 'reassigned')
      .map((s) => s.technicianId),
  );
  return [...receiving].flatMap((id) => {
    const t = rows.get(id);
    return t ? [`${t.technician.name} already has ${t.loadMinutes} min of work booked today`] : [];
  });
}

/**
 * How `plan` differs from `other`, best-first: "8 min less driving",
 * "1 more job moved". Only differences are listed; equal metrics say nothing.
 */
export function compareToOther(plan: CandidatePlan, other: CandidatePlan): { better: string[]; worse: string[] } {
  const better: string[] = [];
  const worse: string[] = [];
  for (const key of METRIC_ORDER) {
    const mine = plan.metrics[key];
    const theirs = other.metrics[key];
    // Plans stored before a metric existed have no value for it; say nothing.
    if (mine === undefined || theirs === undefined) continue;
    const diff = mine - theirs;
    if (diff === 0) continue;
    const phrase = deltaPhrase(key, Math.abs(diff), diff < 0);
    (diff < 0 ? better : worse).push(phrase);
  }
  return { better, worse };
}

function deltaPhrase(key: keyof PlanMetrics, n: number, less: boolean): string {
  const more = less ? 'less' : 'more';
  const fewer = less ? 'fewer' : 'more';
  switch (key) {
    case 'slaLatenessMinutes':
      return `${n} min ${less ? 'less late' : 'later'} for the customer`;
    case 'travelMinutes':
      return `${n} min ${more} driving`;
    case 'overtimeMinutes':
      return `${n} min ${more} overtime`;
    case 'jobsMoved':
      return `${n} ${fewer} ${n === 1 ? 'job' : 'jobs'} moved`;
    case 'customersAffected':
      return `${n} ${fewer} ${n === 1 ? 'customer' : 'customers'} to update`;
    case 'unassignedCount':
      return `${n} ${fewer} ${n === 1 ? 'job' : 'jobs'} left without a technician`;
    case 'workloadSpreadPct':
      return `${n} points ${less ? 'more even' : 'less even'} workload`;
  }
}

/**
 * Why the backend marked this plan recommended, in words a coordinator can
 * check. The backend picks the option built for the coordinator's priority
 * setting; when that option is also no worse on any stored measure, that is
 * the stronger reason and is said first. Compares stored metrics only.
 */
export function recommendationReason(
  selectionBasis: 'requested_profile' | 'available_validated_plan' | undefined,
  plan: CandidatePlan | undefined,
  other?: CandidatePlan,
): string | null {
  if (!plan) return null;
  if (selectionBasis === 'available_validated_plan') return 'It’s the only option that passed every safety check.';
  const setting = `your priority setting, “${profileName(plan.profile)}”`;
  if (!other) return `It matches ${setting}.`;
  const vs = compareToOther(plan, other);
  if (vs.worse.length === 0 && vs.better.length > 0) {
    return `It’s as good or better on every measure: ${vs.better.join(', ')}.`;
  }
  if (vs.worse.length === 0) return `Both options come out the same, so it follows ${setting}.`;
  const theirs = compareToOther(other, plan).better;
  return `It matches ${setting}: ${vs.better.join(', ') || 'it keeps to that priority'}. “${profileName(other.profile)}” would mean ${theirs.join(', ')}.`;
}

/** One-click reasons for approving `plan`, specific first. The coordinator can edit any of them. */
export function approveReasons(board: DeskBoard, plan: CandidatePlan | undefined, others: CandidatePlan[]): string[] {
  if (!plan) return [];
  const reasons: string[] = [];
  const first = describeChanges(board, plan)[0];
  const other = others.find((p) => p.id !== plan.id);
  if (plan.profile === 'sla_first') reasons.push('Customer needs this done inside the promised window.');
  else reasons.push('Keeps everyone else’s day as planned.');
  if (other) {
    const { better } = compareToOther(plan, other);
    if (better[0]) reasons.push(`${capitalise(better[0])} than the other option.`);
  }
  if (first) reasons.push(`${first.split(',')[0]} — confirmed they can take it.`);
  reasons.push('Matches what I know on the ground.');
  return reasons;
}

export const REJECT_REASONS = [
  'Customer asked to reschedule.',
  'I will arrange this by phone.',
  'Technician is not actually free.',
  'Neither option fits what I know on the ground.',
];

/** What a refusal means for the person at the desk. The code stays visible under "Technical details". */
export function refusalCopy(code: string): { title: string; detail: string } {
  switch (code) {
    case 'gateway_unavailable':
    case 'planning_timeout':
    case 'scheduler_timeout':
      return { title: 'Couldn’t work out options in time', detail: 'Nothing was changed. This is usually temporary; try again.' };
    case 'stale_snapshot':
    case 'snapshot_mismatch':
    case 'stale_planning_context':
      return { title: 'The schedule changed while you were deciding', detail: 'Nothing was applied. Someone may have changed it from another desk. The board has been refreshed; raise the problem again for options on the current schedule.' };
    case 'event_gone':
    case 'event_not_found':
      return { title: 'This event was cleared', detail: 'The board was reset while options were being worked out, perhaps from another desk. Nothing was changed. Raise it again if it still applies.' };
    case 'invalid_event_context':
      return { title: 'That job isn’t on this board', detail: 'It may have been removed or the board reset from another desk. Nothing was changed. Check the board and try again.' };
    case 'no_candidate_plans':
      return { title: 'No safe option found', detail: 'Every option broke a rule (skills, shifts, customer windows or parts). Arrange this one manually.' };
    case 'approval_required':
      return { title: 'Approval needed first', detail: 'Approve a plan before it can be applied.' };
    case 'already_committed':
      return { title: 'Already applied', detail: 'This plan is already on the schedule.' };
    case 'proposal_rejected':
      return { title: 'Options were rejected', detail: 'Raise the problem again for new options.' };
    case 'commit_blocked':
    case 'validation_failed':
      return { title: 'This plan failed a safety check', detail: 'Nothing was applied. Pick the other option or arrange it manually.' };
    case 'proposal_exists':
    case 'planning_in_progress':
      return { title: 'Already working on this', detail: 'Options for this problem are on their way or already shown.' };
    default:
      return { title: 'Something went wrong', detail: 'Nothing was changed. Try again, or arrange this one manually.' };
  }
}

/** Validator codes, as a coordinator would say them. */
export function violationCopy(violation: string): string {
  const code = violation.split(':')[0];
  const text: Record<string, string> = {
    DUPLICATE_ASSIGNMENT: 'A job is booked twice',
    OVERLAP: 'A technician would be in two places at once',
    TRAVEL_INFEASIBLE: 'Not enough time to drive between jobs',
    EXCESSIVE_OVERTIME: 'Too much overtime for one technician',
    IN_PROGRESS_MOVED: 'Moves a job that has already started',
    LOCKED_MOVED: 'Moves a job the customer was promised',
    OUTSIDE_SHIFT: 'Outside the technician’s shift',
    MISSING_PARTS: 'Technician doesn’t have the parts on the van',
    MISSING_CERT: 'Technician isn’t certified for this job',
    CERT_EXPIRED: 'Technician’s certificate has expired',
    WINDOW_INFEASIBLE: 'Can’t make the customer’s time window',
  };
  return (code && text[code]) ?? violation;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** An event's backend status, as the coordinator would say it. */
export function eventStatusCopy(status: OperationalEventStatus | string): {
  label: string;
  tone: 'warning' | 'success' | 'danger' | 'secondary';
  open: boolean;
} {
  switch (status) {
    case 'RECEIVED':
    case 'VALIDATED':
    case 'PLANNING':
      return { label: 'Finding options…', tone: 'warning', open: true };
    case 'PROPOSAL_READY':
    case 'AWAITING_APPROVAL':
      return { label: 'Waiting for you', tone: 'warning', open: true };
    case 'COMMITTED':
      return { label: 'Schedule updated', tone: 'success', open: false };
    case 'REJECTED':
      return { label: 'Handled manually', tone: 'secondary', open: false };
    case 'INFEASIBLE':
      return { label: 'No safe option', tone: 'danger', open: false };
    case 'INVALID':
      return { label: 'Couldn’t read this event', tone: 'danger', open: false };
    case 'FAILED':
      return { label: 'Couldn’t plan', tone: 'danger', open: false };
    case 'SUPERSEDED':
      return { label: 'Out of date', tone: 'secondary', open: false };
    default:
      return { label: status, tone: 'secondary', open: false };
  }
}
