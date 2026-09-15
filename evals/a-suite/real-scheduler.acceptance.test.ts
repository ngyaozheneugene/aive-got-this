/**
 * Explicit G1 legality gate. These are real assertions, not expected failures.
 * RUN_SCHEDULER_ACCEPTANCE=1 runs the known-open upstream checks, without LLM calls.
 * Default regression success MUST NOT be reported as passing this acceptance gate.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { buildBoardSchedule } from '../../src/dispatch/board-schedule';
import { propose } from '../../src/matching/propose';
import { validatePlan } from '../../src/matching/validate';
import { stageA } from '../../src/matching/gates/stage-a';
import { setupAgent } from './fixtures';

const enabled = process.env.RUN_SCHEDULER_ACCEPTANCE === '1';
const checks: Array<{ name: string; passed: boolean; evidence: Record<string, unknown> }> = [];
async function realCase() {
  const h = await setupAgent();
  const schedule = await buildBoardSchedule(h.db);
  const output = propose({ event: h.event, schedule, profile: 'sla_first' });
  const job = schedule.jobs.find((row) => row.id === 'job_raffles')!;
  expect(output.plans).toHaveLength(2);
  return { ...h, schedule, output, job };
}

describe.skipIf(!enabled)('G1 real scheduler legality acceptance (upstream blockers)', () => {
  it('A-01: both Raffles plans must respect the actual customer window', async () => {
    const h = await realCase();
    const slots = h.output.plans.map((plan) => {
      const slot = plan.assignments.find((row) => row.jobId === h.job.id)!;
      return { profile: plan.profile, start: slot.windowStart, end: slot.windowEnd,
        insideWindow: Number.isFinite(Date.parse(slot.windowStart ?? '')) &&
          Number.isFinite(Date.parse(slot.windowEnd ?? '')) &&
          Date.parse(slot.windowStart!) >= Date.parse(h.job.windowStart!) &&
          Date.parse(slot.windowEnd!) <= Date.parse(h.job.windowEnd!),
        validatorAccepted: validatePlan(plan, h.schedule).ok };
    });
    checks.push({ name: 'customer_window', passed: slots.every((slot) => slot.insideWindow),
      evidence: { customerStart: h.job.windowStart, customerEnd: h.job.windowEnd, slots } });
    expect(slots.every((slot) => slot.insideWindow), 'A validator-accepted plan must not start before the customer window.').toBe(true);
  });
  it('X-01: the independent validator must reject an injected unqualified assignee', async () => {
    const h = await realCase();
    const plan = structuredClone(h.output.plans[0]!);
    plan.assignments.find((slot) => slot.jobId === h.job.id)!.technicianId = 'tech_wei';
    const verdict = validatePlan(plan, h.schedule);
    const certified = await h.db.technicians.certValidOn('tech_wei', 'NEA_R32', h.schedule.date);
    checks.push({ name: 'independent_certificate_check', passed: !certified && !verdict.ok,
      evidence: { certified, validatorAccepted: verdict.ok, violations: verdict.violations } });
    expect(certified).toBe(false);
    expect(verdict.ok, 'Independent validation must reject Wei even when a candidate bypasses Stage A.').toBe(false);
  });
  it('A-01: Stage A must exclude a technician missing the required carried part', async () => {
    const h = await realCase();
    const siti = { ...h.schedule.technicians.find((row) => row.id === 'tech_siti')!, parts: [] };
    const result = stageA(h.job, [siti], h.schedule.certs, h.schedule.shifts, h.schedule.jobRequirements)[0]!;
    checks.push({ name: 'required_parts', passed: !result.isEligible,
      evidence: { partsRequired: h.job.partsRequired, partsCarried: siti.parts, eligible: result.isEligible,
        exclusionReasons: result.exclusionReasons } });
    expect(result.isEligible, 'Holding the certificates does not replace the missing inverter board.').toBe(false);
  });
  it('A-01: Stage A must exclude a technician with no recorded shift', async () => {
    const h = await realCase();
    const siti = h.schedule.technicians.find((row) => row.id === 'tech_siti')!;
    const result = stageA(h.job, [siti], h.schedule.certs, [], h.schedule.jobRequirements)[0]!;
    checks.push({ name: 'missing_shift', passed: !result.isEligible,
      evidence: { recordedShifts: 0, eligible: result.isEligible, exclusionReasons: result.exclusionReasons } });
    expect(result.isEligible, 'Absent shift evidence must not establish availability.').toBe(false);
  });
  afterAll(() => {
    const report = {
      checkedAt: new Date().toISOString(), sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      upstreamMain: execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).trim(),
      status: checks.length === 4 && checks.every((check) => check.passed) ? 'passed' : 'failed',
      expectedChecks: 4, checks,
      evidenceScope: 'Real main scheduler, Stage A and validator; memory fixture only. No model, external requests or persisted board changes.',
    };
    mkdirSync('docs/team/member-3', { recursive: true });
    const filename = `docs/team/member-3/scheduler-acceptance-${Date.now()}.json`;
    writeFileSync(filename, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.info(`Scheduler acceptance evidence: ${filename}; status=${report.status}`);
  });
});
