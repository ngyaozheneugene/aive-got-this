# ADR 007 — Partial coverage

**Status:** Accepted
**Date:** 8 Oct 2026
**Owner:** Deen (finals round, all streams)

## Context

When a disruption left even one job that no technician could legally take, both engines returned no plan at all. On the finals board that happened for most sick calls, because every morning is booked. One impossible job blocked the coordinator from moving the other jobs that could be covered. The G3 board recorded it as a known limitation: "the real answer is partial coverage, which needs the commit path to support un-assigning."

## Decision

1. **A plan may leave a booked job for a call.** It is recorded in the plan's `changeSet` as `{ action: 'unassign', jobId, fromTechnicianId, reason }` and left out of `assignments`. No schema or contract change: `changeSet` is already free-form JSON. `src/matching/unassigned.ts` reads and writes it. The reasons:
   - `promised`: the window was promised to this technician, so no one else may take it.
   - `no_legal_technician`: nobody else passes Stage A.
   - `no_time`: qualified people exist, but none can fit it.
2. **Only as a last resort.**
   - The sidecar gives each booked job a sick call or overrun puts in play a "leave it" option, costed at 1,000,000. That is above any legal arrangement, so it is chosen only when nothing legal exists.
   - The insertion fallback leaves a job only after the booked time and every later start in the window have failed.
   - An urgent job itself is never left: a plan that does not place it is no plan.
   - Rebalanceable jobs are never left.
3. **Validator.** A job left for a call and also placed is `DUPLICATE_ASSIGNMENT`. Leaving work already started is `IN_PROGRESS_MOVED`. These reuse the frozen vocabulary.
4. **Metrics and risk.**
   - `unassignedCount` already counted in-play jobs left unplaced.
   - `customersAffected` now includes customers whose booking is cancelled.
   - New risk reason `unassigned_jobs` (medium): a person approves.
5. **Commit.** It cancels the job's live assignment (`cancelled`, not `reassigned`), sets the job back to `unassigned` with a `partial_coverage:<reason>` status event, and leaves it out of the snapshot. The job reappears under "Needs a technician", where "Find a technician" can try again later.
6. **Desk.** The plan card lists each job left for a call, with the customer, time, former technician and reason. While a plan is previewed, those jobs show in the waiting list as "Preview: call customer".

## Found on the way

- **The fallback planner handed promised jobs to someone else** on a sick call, and the validator refused the plan with `LOCKED_MOVED`. Promised jobs are now left for a call, as the solver already did.
- **Overruns on any job not seeded as on site always failed validation** (`WINDOW_INFEASIBLE` on the overrunning job itself). A job reported running late has started: `applyDisruption` now marks it on site for planning, and commit records it.

## Evidence

- `evals/g-suite/g12-partial-coverage.test.ts` (real solver):
  - Mei off sick leaves Northpoint's promised slot (`promised`) and moves the rest.
  - Siti off sick names what cannot fit.
  - A 180-minute overrun on Marcus plans legally.
  - Commit cancels the booking and returns the job to waiting.
- With OR-Tools, 9 of 15 possible sick calls on the finals board now need partial coverage. Before, they returned no plan.
- `src/matching/measure.test.ts`: on the Eastwind board, Kumar off sick, which used to return no plan, now covers what it can.
