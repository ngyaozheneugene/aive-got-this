# ADR 003 — G0 contracts: plan metrics, Eastwind, product APIs

**Status:** Accepted
**Date:** 9 Sep 2026
**Owners:** Eugene, Damon, Deen, Khant (members 1–4, shared freeze)

## Context

Nobody had implemented application behaviour yet. The tree still had v0.4 ranking scores, 16 memory technicians, and `intake` / `coordinator` / `webhooks` API folders. The control-tower plan needs plan-level metrics, six Eastwind vans, and the schedule/events/proposals HTTP shape.

## Decision

1. `PlanMetrics` replaces v0.4 `ScoreBreakdown`. Assignment JSON column `score_breakdown` stores plan metrics.
2. Canonical Tuesday is `src/shared/fixtures/eastwind.ts` (6 technicians, 12 jobs, Raffles Place unassigned, locked SLA, in-progress Bedok job, Wei expired R32).
3. Product APIs are `/api/schedule/current`, `/api/events`, `/api/proposals/{id}`, decision, commit, audit, `/api/demo/reset`, `/health`.
4. `src/shared/contracts` may import `zod`. The rest of `src/shared/` still imports nothing else.
5. Default runtime is the memory adapter (`USE_MEMORY_DB` not `false`) so G1 work does not wait on SQL seed.

## Consequences

- Insertion `propose()` is still a stub returning no plans. G1 fills it.
- Postgres `seed()` is still empty. Apply the TypeScript fixture via SQL in Week 1 if the box uses Postgres.
- Gateway smoke is still a human/member-3 action.
