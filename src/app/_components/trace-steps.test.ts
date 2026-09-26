import { describe, expect, it } from 'vitest';
import type { DecisionLog } from '../../shared/types/domain';
import { eventStatusCopy } from './copy';
import { tracePhases, traceSteps } from './trace-steps';

let n = 0;
function row(stage: string, summary: string, extra: Partial<DecisionLog> = {}): DecisionLog {
  n += 1;
  return {
    id: `log_${n}`,
    eventId: 'ev_1',
    eventType: 'urgent_job',
    playbook: 'urgent_job',
    sequence: n,
    stage,
    toolCalls: [],
    summary,
    durationMs: 1000,
    result: 'ok',
    createdAt: '2026-09-15T05:00:00.000Z',
    ...extra,
  };
}

// The shape plan-event.ts, decision.ts and commit.ts actually store.
const log: DecisionLog[] = [
  row('retrieve_board', 'Agent tool retrieve_board: ok.'),
  row('propose', 'Agent tool propose: ok.'),
  row('propose', 'Agent tool propose: ok.'),
  row('validate', 'Agent tool validate: ok.'),
  row('validate', 'Agent tool validate: ok.'),
  row('classify_risk', 'Risk medium (approval) from stored plan evidence, not a model score.', {
    toolCalls: [{ tool: 'classify_risk', args: {}, result: { risk: 'medium', autonomyMode: 'approval' } }],
  }),
  row('compare_plans', 'Comparison ready.'),
  row('persist_proposal', 'Stored 2 agent-validated candidate(s).'),
  row('decision', 'Desk approved plan_sla: Customer needs this done inside the promised window.', { result: 'approved' }),
  row('commit', 'Committed plan plan_sla (sla_first) as snapshot v2. 1 assignment(s) written by desk_coordinator.', {
    result: 'committed',
  }),
];

describe('traceSteps', () => {
  it('folds consecutive repeats and keeps who acted', () => {
    const steps = traceSteps(log);
    expect(steps.map((s) => [s.label, s.actor, s.count])).toEqual([
      ['Read today’s schedule', 'ai', 1],
      ['Asked the scheduler for options', 'ai', 2],
      ['Ran the safety checks', 'ai', 2],
      ['Risk check', 'system', 1],
      ['Compared the options', 'system', 1],
      ['Saved the options for you', 'system', 1],
      ['You approved an option', 'you', 1],
      ['Schedule updated', 'system', 1],
    ]);
    expect(steps[1]!.durationMs).toBe(2000);
  });

  it('puts risk, the person’s reason and the version in words', () => {
    const steps = traceSteps(log);
    expect(steps.find((s) => s.stage === 'classify_risk')!.detail).toBe('Rated medium risk, so a person must approve.');
    expect(steps.find((s) => s.actor === 'you')!.detail).toBe('Your reason: “Customer needs this done inside the promised window.”');
    expect(steps.find((s) => s.stage === 'commit')!.detail).toBe('Written as schedule version 2.');
  });

  it('never folds a failed step into a successful one', () => {
    const steps = traceSteps([
      row('propose', 'Agent tool propose: ok.'),
      row('propose', 'Agent tool propose: error.', { result: 'error' }),
    ]);
    expect(steps.map((s) => [s.count, s.failed])).toEqual([[1, false], [1, true]]);
  });

  it('reads a rejection as the person’s decision', () => {
    const [step] = traceSteps([row('decision', 'Desk rejected plan_x: I will arrange this by phone.', { result: 'rejected' })]);
    expect(step).toMatchObject({ actor: 'you', label: 'You rejected both options' });
  });
});

describe('tracePhases', () => {
  it('groups the run as AI → system → you → system', () => {
    expect(tracePhases(log).map((p) => [p.actor, p.steps.length])).toEqual([
      ['ai', 3],
      ['system', 3],
      ['you', 1],
      ['system', 1],
    ]);
  });
});

describe('eventStatusCopy', () => {
  it('marks what still needs the coordinator as open', () => {
    expect(eventStatusCopy('AWAITING_APPROVAL')).toMatchObject({ label: 'Waiting for you', open: true });
    expect(eventStatusCopy('PLANNING').open).toBe(true);
    expect(eventStatusCopy('COMMITTED')).toMatchObject({ label: 'Schedule updated', open: false });
    expect(eventStatusCopy('REJECTED').open).toBe(false);
  });
});
