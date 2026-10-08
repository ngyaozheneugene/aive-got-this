# ADR 014 — Placing every waiting job in one plan

**Status:** Accepted
**Date:** 8 Oct 2026
**Owner:** Deen (finals round, all streams)

## Context

Job import (ADR 013) can put many jobs on the board at once, all waiting for a technician. Each then needed its own "Find a technician": one event, one plan of about 20 seconds, and one approval per job. Planning was built around one event and one job at a time.

## Decision

1. **A new event type, `place_waiting`, with a payload of 1 to 60 job IDs.** It is not an overloaded `urgent_job`, so the existing flows are untouched. The contract is `placeWaitingPayloadSchema`. The affected IDs are the job IDs. Migration 0004 widens the event-type CHECK constraint.
2. **Same path as every event.**
   - The agent reads the context. Every listed job must be on today's board and still waiting; one placed since the request was made makes the request stale (`PLANNING_CONTEXT_CHANGED`).
   - It proposes both profiles and validates each.
   - Code-owned risk applies: a new assignment always means APPROVAL.
   - Then one decision and one commit. Commit marks every placed job `assigned`.
3. **The solver** places every listed job **around booked work, which stays where it is.**
   - Opening the whole day as `urgent_job` does made the model too big: nine jobs found no solution in 5 seconds.
   - A bulk placement also should not reshuffle customers who are already booked.
   - A job nobody can legally take (`no_legal_technician`), that cannot fit its window (`window_too_short`), or for which no qualified technician is free (`no_time`) is **left waiting** with that reason, rather than failing the plan. It becomes a `leave_waiting` entry in the change set.
   - Leaving a job costs more than any arrangement, and five times more for an urgent job, so the solver places everything it legally can.
4. **The fallback**, used when the solver is unreachable or slow, places the jobs one at a time, urgent first and then by window. Each is placed by the single-job insertion on top of those already placed, and the same reasons apply. The validator checks it like any plan.
5. **`measurePlan`** counts every listed job that is not placed in `unassignedCount`.
6. **The board.**
   - **Plan all N** appears in "Needs a technician" when two or more jobs wait.
   - The plan card lists what stays waiting and why, and notes that "Find a technician" on one of those jobs alone can move booked work to make room.

## Evidence

- `src/dispatch/place-waiting.test.ts`:
  - the event contract;
  - the fallback places all it can on both profiles, and both validate;
  - a job nobody is qualified for is left waiting with its reason;
  - a stale request is refused;
  - commit assigns the placed jobs and leaves the rest waiting.
- G-13 against the real solver: nine waiting jobs across the island. Eight are placed inside their windows on both profiles, with no booked job unbooked.
  - The 08:30 Novena leak stays `no_time`: every tier 2 technician is booked all morning. The fallback agrees.
  - Adding a job nobody may take leaves it `no_legal_technician` and places the rest.
  - G-suite 51/51.
- Desk, local simulation with the live agent and solver:
  - five imported jobs plus Raffles Place → **Plan all 6** → one plan ("On-time first" recommended, five placed, Far East Medical "stays waiting: no qualified technician is free inside its window");
  - approved with a reason, then committed to version 2;
  - the five jobs became `assigned` with Kumar, Ben, Jonah and Siti. Far East Medical alone still waits.
