// Turns the stored decision log for one event into the step graph the desk
// draws: what the AI chose, what the system checked, what the person decided.
// JSX-free so the grouping is unit tested. Reads stored rows only.
import type { DecisionLog } from '../../shared/types/domain';

export type Actor = 'ai' | 'system' | 'you';

export interface TraceStep {
  key: string;
  stage: string;
  actor: Actor;
  label: string;
  /** Consecutive runs of the same step, e.g. the AI asking for options twice. */
  count: number;
  failed: boolean;
  durationMs: number;
  /** A plain sentence for the step, from stored fields. */
  detail: string;
  entries: DecisionLog[];
}

export interface TracePhase {
  actor: Actor;
  steps: TraceStep[];
}

export const ACTOR_COPY: Record<Actor, { name: string; blurb: string }> = {
  ai: { name: 'AI chose', blurb: 'The assistant picks which step to take next.' },
  system: { name: 'System checked', blurb: 'Rules and checks run by code, not the AI.' },
  you: { name: 'You decided', blurb: 'Nothing changes on the schedule without this.' },
};

const AI_LABELS: Record<string, string> = {
  retrieve_board: 'Read today’s schedule',
  propose: 'Asked the scheduler for options',
  validate: 'Ran the safety checks',
  classify_risk: 'Asked for a risk check',
  request_approval: 'Asked for your approval',
  audit: 'Checked the record',
};

const SYSTEM_LABELS: Record<string, string> = {
  structured_fallback: 'Backup planner (assistant unavailable)',
  classify_risk: 'Risk check',
  compare_plans: 'Compared the options',
  persist_proposal: 'Saved the options for you',
  commit: 'Schedule updated',
};

function actorOf(entry: DecisionLog): Actor {
  if (entry.stage === 'decision') return 'you';
  if (entry.summary.startsWith('Agent tool ')) return 'ai';
  return 'system';
}

function labelOf(entry: DecisionLog, actor: Actor): string {
  const stage = entry.stage ?? entry.playbook;
  if (actor === 'you') {
    return entry.result === 'rejected' ? 'You rejected both options' : 'You approved an option';
  }
  const labels = actor === 'ai' ? AI_LABELS : SYSTEM_LABELS;
  return labels[stage] ?? stage.replace(/_/g, ' ');
}

function detailOf(entry: DecisionLog, actor: Actor): string {
  const result = entry.toolCalls[0]?.result ?? {};
  if (actor === 'you') {
    // Stored as "Desk approved <planId>: <reason>".
    const reason = entry.summary.split(': ').slice(1).join(': ');
    return reason ? `Your reason: “${reason}”` : entry.summary;
  }
  switch (entry.stage) {
    case 'classify_risk':
      return typeof result.risk === 'string' ? `Rated ${result.risk} risk, so ${result.autonomyMode === 'approval' ? 'a person must approve' : 'it follows the policy'}.` : entry.summary;
    case 'persist_proposal':
      return 'Options stored with the schedule they were made against, so nothing stale can be applied.';
    case 'commit': {
      const v = /snapshot v(\d+)/.exec(entry.summary)?.[1];
      return v ? `Written as schedule version ${v}.` : entry.summary;
    }
    default:
      return entry.result === 'error' ? 'This step failed.' : entry.summary;
  }
}

/** Ordered steps, with consecutive repeats of the same step folded into one. */
export function traceSteps(entries: DecisionLog[]): TraceStep[] {
  const ordered = [...entries].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const steps: TraceStep[] = [];
  for (const entry of ordered) {
    const actor = actorOf(entry);
    const stage = entry.stage ?? entry.playbook;
    const failed = entry.result === 'error';
    const last = steps[steps.length - 1];
    if (last && last.stage === stage && last.actor === actor && !failed && !last.failed) {
      last.count += 1;
      last.durationMs += entry.durationMs ?? 0;
      last.entries.push(entry);
      continue;
    }
    steps.push({
      key: entry.id,
      stage,
      actor,
      label: labelOf(entry, actor),
      count: 1,
      failed,
      durationMs: entry.durationMs ?? 0,
      detail: detailOf(entry, actor),
      entries: [entry],
    });
  }
  return steps;
}

/** Steps grouped into consecutive runs by who acted: AI → system → you. */
export function tracePhases(entries: DecisionLog[]): TracePhase[] {
  const phases: TracePhase[] = [];
  for (const step of traceSteps(entries)) {
    const last = phases[phases.length - 1];
    if (last && last.actor === step.actor) last.steps.push(step);
    else phases.push({ actor: step.actor, steps: [step] });
  }
  return phases;
}
