import { emptyPlanMetrics } from '../../shared/types/domain';
import type { CandidatePlan, PlanMetrics, PlanProfile } from '../../shared/types/domain';

export interface PlanComparison {
  comparisonReady: boolean;
  profiles: PlanProfile[];
  metrics: Partial<Record<PlanProfile, PlanMetrics>>;
  deltas: Partial<Record<keyof PlanMetrics, number>>;
  reasons: string[];
}

/** Backend-owned comparison. Never ranks in a prompt or invents metrics. */
export function compareCandidatePlans(plans: readonly CandidatePlan[]): PlanComparison {
  const accepted = plans.filter((plan) =>
    plan.validations.ok && plan.validations.violations.length === 0 && plan.status !== 'REJECTED');
  const metrics: Partial<Record<PlanProfile, PlanMetrics>> = {};
  for (const plan of accepted) metrics[plan.profile] = plan.metrics ?? emptyPlanMetrics();
  const profiles = (['sla_first', 'minimal_disruption'] as const)
    .filter((profile) => metrics[profile]);
  const sla = metrics.sla_first;
  const quiet = metrics.minimal_disruption;
  const deltas: PlanComparison['deltas'] = {};
  const reasons: string[] = [];
  if (sla && quiet) {
    (Object.keys(emptyPlanMetrics()) as (keyof PlanMetrics)[]).forEach((key) => {
      deltas[key] = sla[key] - quiet[key];
    });
    reasons.push('stored_metrics_only');
  } else {
    reasons.push('single_profile');
  }
  return { comparisonReady: profiles.length === 2, profiles, metrics, deltas, reasons };
}
