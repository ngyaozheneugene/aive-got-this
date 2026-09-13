// Soft-objective weights for propose() profiles. Imports nothing.

export const PLAN_WEIGHTS = {
  sla_first: {
    slaLateness: 0.45,
    travel: 0.15,
    overtime: 0.15,
    disruption: 0.15,
    imbalance: 0.1,
  },
  minimal_disruption: {
    slaLateness: 0.15,
    travel: 0.15,
    overtime: 0.1,
    disruption: 0.5,
    imbalance: 0.1,
  },
} as const;
