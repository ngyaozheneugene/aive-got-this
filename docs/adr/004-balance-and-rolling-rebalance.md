# ADR 004 — Measured metrics, workload balance, rolling rebalance

**Status:** Accepted by Deen; pending Damon's review (PR #23)
**Date:** 27 Sep 2026
**Owners:** Damon (scheduler), Deen (agent). Consumers: Khant (desk)

## Context

The problem statement asks for technician assignment by availability, location, skills and urgency. It names three results of doing this badly: excessive travel, delayed appointments, and **uneven utilisation**. It also says requests keep **arriving through the day**. Checking the product against it on 27 Sep found three gaps:

1. The insertion fallbacks reported constants: `travelMinutes: 30`, overtime equal to the overrun, a fixed customer count. The sidecar measured its plans in Python with its own definitions. So the desk compared numbers that did not mean the same thing.
2. Nothing measured workload balance. The `imbalance` weight only saw the chosen technician's own load. On the Eastwind sick call, both profiles gave both of Hafiz's jobs to Jonah (69% of his day) while Wei sat at 25%. The desk then showed two identical plans.
3. An urgent job could only be inserted around the day as booked. It could never move booked work to free the right technician.

ADR 001 made the sidecar the engine for unavailable and overrun, with insertion for urgent jobs. This ADR extends that.

## Decision

1. **One measurement.** `measurePlan(slots, event, schedule)` in `src/matching/measure.ts` computes every plan's metrics against the live board, whichever engine produced it. The sidecar's own numbers are overwritten.
   - `travelMinutes` is the fleet driving the plan adds, from each technician's route in start order. It is negative when the plan saves driving.
   - An overrunning job's own extension counts as lateness, not as a moved job.
   - `unassignedCount` counts only jobs the event put in play.
2. **Workload gap.** New optional `PlanMetrics.workloadSpreadPct`: the busiest minus the idlest working technician, as % of each one's `maxMinutesDay`. "Working" means active, not the unavailable technician, and on a `scheduled` / `clocked_in` shift. It is optional so stored plans still parse. Non-breaking.
3. **Objectives.**
   - Both solver profiles minimise the workload gap. `sla_first` values one point at 6 units, about 1.2 drive minutes. `minimal_disruption` values it at 5.
   - `minimal_disruption` reads the receiving technician's load pressure as insertion does, with a 1.25× penalty for technicians who do not accept overtime.
   - `minimal_disruption` charges waiting time on new jobs, so an urgent job is not parked at the end of its window.
   - The insertion fallbacks use the same cost terms, so the two engines make the same trade.
4. **Rolling rebalance for urgent jobs.**
   - `urgent_job` goes through the sidecar; insertion is the 10 s fallback.
   - A booked job may change technician, never time, to free the right person, when all of these hold:
     - it has not started;
     - its lock state is `none`;
     - its own technician is still legal for it;
     - it starts at least `FROZEN_HORIZON_MINUTES` (60) after the board's "now". "Now" is the latest start of work under way, else the earliest clock-in.
   - In `sla_first` a rebalance move costs `REBALANCE_MOVE_COST` (60, about 12 drive minutes). In `minimal_disruption` every move costs 1,000, so that profile only inserts.
5. **Legal fallbacks.** The unavailable fallback no longer hands a job to a Stage A–excluded technician. When nobody legal can take a job, it returns `no_legal_technician`. With the sidecar unreachable, an empty Stage A set on an urgent job is reported as a verdict (409), not a retryable timeout.

## Consequences

| Demo scenario (Eastwind, real solver) | On-time first | Least disruption |
|---|---|---|
| Urgent Raffles | Siti 13:00, +22 min (unchanged) | Jonah 13:00, +30 min (unchanged) |
| Hafiz sick | Jonah + Wei; gap 12%; +64 min | Jonah both; gap 44%; +32 min |
| Overrun 45 | absorbed | absorbed |
| Overrun 90 | 2 jobs move (his 14:00 also goes to Wei) | 1 job moves |

- The sick-call scenario is now a real trade-off, where before it was two identical plans. The 90-minute overrun under On-time first moves two jobs, so the rehearsal script changes.
- On Eastwind, rolling rebalance never pays, so the plans don't change. G-08 proves it on a variant board: Siti is the only qualified technician and is booked at 13:00. The solver hands her booked job to Wei at the same time; insertion alone would overlap her.
- Evidence: offline suite 274; `RUN_SIDECAR_ACCEPTANCE=1` G-08 7/7; `RUN_SCHEDULER_ACCEPTANCE=1` 4/4.
- Weights were set on one board. They are named constants in `app.py` and `FALLBACK_COST` in `propose.ts`; keep the two in step.
- Not yet deployed. The box needs the sidecar image rebuilt.
