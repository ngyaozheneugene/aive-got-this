# Task board

**Current gate:** G0  
**Kickoff:** 9 Sep 2026 (Day 1 unless the team records otherwise)  
**Agents:** read [`AGENTS.md`](../AGENTS.md), then this file. Tick boxes you complete. Do not invent a parallel TODO.  
**Humans:** Eugene (1 platform), Damon (2 scheduler), Deen (3 agent), Khant (4 desk).

Until G0 is all `[x]`, do not start OpenClaw, live maps, OR-Tools polish, Cognito, or a second web stack.

Move **Current gate** forward only when that gate’s exit line is satisfied.

| Gate | Day | Exit |
|---|---|---|
| G0 | 2 | Contracts, fixtures, local run, gateway smoke |
| G1 | 5 | Urgent event → valid proposal visible on the desk (insertion) |
| G2 | 10 | Recommend, risk, approval, commit, new snapshot |
| G3 | 14 | Three events, sidecar on replans, guardrails, trace, core tests |
| G4 | 18 | Acceptance, backup, rollback, five timed 30-minute rehearsals |
| G5 | 21 | Submit links, code, evidence, media |

---

## G0 — Contracts (Day 2)

- [x] Execution docs: plan, stack, ADRs, team briefs, workflow, use cases
- [x] Schema + domain types for events, proposals, candidate plans, risk, snapshots
- [x] `IDatabase` + memory + postgres adapters
- [x] Optimizer sidecar skeleton: `GET /health`, stub `POST /propose`, Compose service
- [x] `src/shared/contracts/` — Zod for events, `propose()`, tools
- [x] `src/shared/config/` — plan weights, timeouts, reason-code enums
- [x] Freeze `propose(event, schedule, profile)` types in `src/shared/`
- [x] Eastwind fixture: 6 techs, 12 jobs, Raffles Place urgent, locked SLA, scarce cert (memory; SQL apply still open)
- [x] **Human:** put four names on members 1–4 (Eugene, Damon, Deen, Khant)
- [ ] Gateway smoke: strict JSON vs native tools; record result; native tools stay off if they fail (Deen)
- [ ] Confirm optimizer `/health` locally via `npm run db:up` (Eugene + Damon)

**G0 exit:** Damon, Deen, and Khant can code against frozen Zod and the memory adapter without waiting on Lightsail. Gateway smoke still needed from Deen.

---

## G1 — Urgent job on the desk (Day 5)

- [ ] Stage A eligibility: cert, tier, shift, window, parts/tools, locks; nearest van can be illegal (2)
- [ ] Travel matrix (cached); scheduling does not use straight-line (2)
- [ ] Insertion `propose()` + independent validator; two valid Raffles Place plans in ≤10 s (2)
- [ ] G-01 / G-02 / G-03 sketched in `evals/g-suite/` (2)
- [x] APIs: `GET /api/schedule/current`, `POST /api/events` (plan / decision / commit still 501)
- [x] Desk: Eastwind list at `/desk` (timeline + two-plan card still G1)
- [ ] Agent: graph state; urgent path as far as “candidates exist” (3)
- [ ] First Lightsail deploy with `/health` (1)

**G1 exit:** a first-time observer sees the Raffles Place disruption and two legal plans. Insertion only; sidecar may still be stub.

---

## G2 — Controlled commit (Day 10)

- [ ] `POST /api/proposals/{id}/decision` and `POST /api/proposals/{id}/commit` (1)
- [ ] Stale `sourceSnapshotId` rejected (1) — UC-07
- [ ] Medium risk cannot commit without an `approval` row (1 + 3) — UC-12
- [ ] High risk / infeasible: no commit path (2 + 3) — UC-02, UC-06
- [ ] Desk: compare, approve/reject with reason, new snapshot on the board (4)
- [ ] `POST /api/demo/reset` idempotent to Eastwind Tuesday (1) — UC-10
- [ ] Risk policy data: AUTO / APPROVAL / BLOCK (3)

**G2 exit:** urgent job through approval to a new versioned snapshot. No P1 technician page until this is green.

---

## G3 — Feature complete (Day 14)

- [ ] Sidecar implements `propose()` for `technician_unavailable` and `job_overrun` (2)
- [ ] Insertion is 10 s timeout fallback only on those events (2)
- [ ] UC-03: in-progress stays; remaining jobs replan as a set
- [ ] UC-04: 45-minute overrun; frozen horizon
- [ ] Agent: compare, explain from evidence, interrupt, resume; playbooks for all three events (3)
- [ ] Desk: unavailable + overrun simulators; trace drawer (4) — UC-13
- [ ] G/A/X: E01–E04, E06–E08 must-pass; E09–E10 safe behaviour (2 + 3)
- [ ] Injection quoted, no assign (3) — UC-05
- [ ] Gateway-down still calls `propose()`; copy does not claim the model ran (3) — UC-08

**G3 exit:** freeze features. Cut OpenClaw/map if they are still ideas.

---

## G4 — Release candidate (Day 18)

- [ ] Five consecutive successful runs after reset (1 + 4)
- [ ] Snapshot backup + rollback drill (1)
- [ ] Five timed 30-minute rehearsals (4 + 3) — rundown in plan §12
- [ ] Backup recording of urgent-job spine (4)
- [ ] Desk polish: loading / empty / failure, keyboard path (4)
- [ ] Technician status page only if G2 stayed green and time remains (4) — UC-15, P1

**G4 exit:** live 30-minute rundown is rehearsed; backup recording exists.

---

## G5 — Submit (Day 21)

- [ ] Public URL, README evidence, spend vs $100
- [ ] Portal submit early enough to fix packaging issues
- [ ] Do not start a second product in leftover time

---

## Parking (not this gate)

Cancellation (UC-14 / E05), customer `(customer)/` routes, live GIS, WhatsApp intake, Cognito, App Runner, RDS, OpenClaw, Hermes, RRULE.

---

## How to update this file

- Tick `- [x]` when the exit evidence exists (test, deployed path, or recorded smoke), not when you started.
- If you block, add a one-line note under the item (`Blocked: waiting on member 2 propose()`).
- Do not delete finished G0 items; they are the audit trail.
- Breaking `src/shared/` : ADR + checkbox note, reviewer from a consumer.
