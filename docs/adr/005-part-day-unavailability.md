# ADR 005 — Part-day unavailability, any-length overruns

**Status:** Accepted
**Date:** 7 Oct 2026
**Owner:** Deen (finals round, all streams)

## Context

The desk could raise three fixed events: Raffles Place urgent, Hafiz off sick, and Hafiz's 08:00 job 90 minutes late. A coordinator could not say "Kumar is stuck in Jurong until 2pm", "Aisha has to leave at 3", or "this job is running 25 minutes late" for anyone else.

Two gaps sat underneath:

1. `technician_unavailable` meant the rest of the day and nothing else.
2. Nothing on the board remembered a committed sick call. The commit moved the jobs but left the shift `clocked_in`, so the next urgent job could hand work straight back to the sick technician. The independent validator never knew about unavailability at all; only the engines did.

## Decision

1. **Contract** (`src/shared/contracts/events.ts`). `technicianUnavailablePayloadSchema` gains optional `from` and `until`, both ISO instants with an offset. Additive.
   - Neither: out for the rest of the day, as before.
   - `until` only: out now, back at that time.
   - `from` only: leaving at that time.
   - Both: refused by `unavailabilityIssue()` (`unavailable_window_both_bounds`). A mid-day gap needs a break model the shift does not have yet.
   - `job_overrun.overrunMinutes` is capped at 480 (`MAX_OVERRUN_MINUTES`).
2. **Unavailability is a shift change.** `src/matching/disruption.ts` is the single place it is defined:
   - all day: shift status `mc`
   - `until`: clock-in moves to that time (never earlier than it was)
   - `from`: clock-out moves to that time (never later than it was)

   `applyDisruption(schedule, event)` returns the board with that change. The agent's context reader applies it, and both engines apply it again on entry (it is idempotent). So insertion, OR-Tools and the validator all plan on the same cut day.
3. **Validator.** `OUTSIDE_SHIFT` now also covers work ending after clock-out. Work already started (`in_progress` / `on_site`) is exempt from shift checks: a technician who goes off sick or leaves early part-way through a job is still the one finishing it.
4. **Engines.**
   - All day: unchanged. Every unstarted job is in play, and the technician takes nothing new.
   - Part of the day: only the jobs outside the new hours are in play. The technician stays a candidate, so the solver can push a job later within its window rather than hand it away.
   - The sidecar bounds every assignment by clock-out as well as clock-in.
   - The insertion fallback, when it reassigns, tries the booked time first and then the earliest start inside the customer's window.
5. **Commit persists it.** Committing an unavailability writes the shift change through the new `IDatabase.shifts.patch`, in the same transaction as the jobs. The next event plans around it.
6. **Desk.** An expanded technician has "Mark … unavailable" (rest of today / out until / leaving at). Each stop has a "running late" control (15–120 minutes, or any number up to 480). Shift changes show on the row ("In from 14:00", "Leaves 15:00", "Off sick today") and shade the day bar.

## Consequences

- An all-day sick call that is committed now sticks: Stage A excludes the technician from then on, and their on-site job stays legal.
- The finals board was fully booked every morning, so no morning absence could be covered without moving other bookings. Daniel (tier 1, south) is now a morning floater: his jobs moved to 11:00 and 13:00. The original three demo outcomes are unchanged (G-09).
- Mid-day gaps and covering only part of an absence wait for partial coverage (G6 R3).

## Evidence

- `src/matching/disruption.test.ts`: patch rules, idempotence, the validator and clock-out, the started-job exemption, the insertion fallback on part of a day, contract limits.
- `evals/g-suite/g10-partial-unavailability.test.ts` (real solver with `RUN_SIDECAR_ACCEPTANCE=1`): out until 14:00, leaving at 15:00, 20- and 150-minute overruns, a committed part-day absence respected by the next urgent job, and a committed sick day that keeps the on-site job legal.
- `npm run test:pg`: `shifts.patch` gives the same results on Postgres and in memory.
