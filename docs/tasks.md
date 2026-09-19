# Task board

**Current gate:** G3 (G0, G1 and G2 complete except one member 4 click-through, noted under G2)
**Kickoff:** 9 Sep 2026 (Day 1)  
**Today:** 20 Sep 2026 — Day 12. G1 and G2 closed; eight days to the wall.
**Hard wall:** the AWS lease and the submission both land ~28 Sep 2026. Confirm the exact
date in the lease portal — the Day 21 row below currently falls *after* it.  
**Agents:** read [`AGENTS.md`](../AGENTS.md), then this file. Tick boxes you complete. Do not invent a parallel TODO.  
**Humans:** Eugene (1 platform), Damon (2 scheduler), Deen (3 agent), Khant (4 desk).

Until G0 is all `[x]`, do not start OpenClaw, live maps, OR-Tools polish, Cognito, or a second web stack.

Move **Current gate** forward only when that gate’s exit line is satisfied.

| Gate | Day | Date | Exit |
|---|---|---|---|
| G0 | 2 | 10 Sep | Contracts, fixtures, local run, gateway smoke |
| G1 | 5 | 13 Sep | Urgent event → valid proposal visible on the desk (insertion) |
| G2 | 10 | 18 Sep | Recommend, risk, approval, commit, new snapshot |
| G3 | 14 | 22 Sep | Three events, sidecar on replans, guardrails, trace, core tests |
| G4 | 18 | 26 Sep | Acceptance, backup, rollback, five timed 30-minute rehearsals |
| G5 | 21 | 29 Sep | Submit links, code, evidence, media — **after the lease ends; pull this earlier** |

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
- [x] Gateway smoke: strict JSON vs native tools; record result; native tools stay off if they fail (Deen)
  - 15 Sep verified: [protocol comparison](team/member-3/gateway-smoke-1789421995331.json) passes native (strict JSON fails); default native client + actual graph passed [urgent](team/member-3/native-agent-smoke-urgent_native-1789422045657.json) and [injected-note](team/member-3/native-agent-smoke-injected_note_native-1789422071772.json) runs with scheduler/validator doubles. This closes G0 transport, not G1 legality.
  - 15 Sep earlier follow-up (historical, resolved by evidence above): owner smoke `gateway-smoke-1789419656751.json` recorded strict JSON failure and native round-trip success. Native client/graph integration added by the local follow-up package; fresh offline and live graph evidence still required before closing G0. See [native integration](team/member-3/native-integration.md).
  - 15 Sep initial implementation (historical): TypeScript gateway client, 23 offline HTTP tests and opt-in two-step strict/native smoke implemented. Live evidence pending local credential setup; no gateway request made. See [member 3 runbook](team/member-3/gateway-and-agent.md).
- [x] Confirm optimizer `/health` locally via `npm run db:up` (Eugene + Damon) — ortools 9.15.6755, both containers healthy

**G0 exit:** Damon, Deen, and Khant can code against frozen Zod and the memory adapter without waiting on Lightsail. Gateway smoke verified and recorded on 15 Sep; native is the tested local source default.

---

## G1 — Urgent job on the desk (Day 5)

- [x] Stage A eligibility: cert, tier, shift, window, parts/tools, locks; nearest van can be illegal (2)
  - 19 Sep verified: Stage A excludes missing parts and absent shift records; all 4 legality checks pass.
- [x] Travel matrix (cached); scheduling does not use straight-line (2)
- [x] Insertion `propose()` + independent validator; two valid Raffles Place plans in ≤10 s (2)
  - 19 Sep verified: Customer windows (13:00–17:00) respected and independent validator rejects unqualified injected assignees. `RUN_SCHEDULER_ACCEPTANCE=1` passes.
- [x] G-01 / G-02 / G-03 sketched in `evals/g-suite/` (2)
- [x] APIs: `GET /api/schedule/current`, `POST /api/events`, `POST /api/events/{id}/plan` (decision / commit published)
- [x] Desk: Eastwind list at `/desk` (timeline + two-plan card still G1)
- [x] Agent: graph state; urgent path as far as “candidates exist” (3)
  - 19 Sep live: real gateway + real scheduler via local `POST /api/events/{id}/plan` returned HTTP 201, native protocol, 5 model calls, two validated Raffles plans in the 13:00–17:00 window, `classify_risk` → medium/approval (`new_assignment`), board unchanged. [Live plan evidence](team/member-3/live-plan-endpoint-1789809106057.json). Retry of [urgent native graph](team/member-3/native-agent-smoke-urgent_native-1789809006405.json) passed after an earlier `MULTIPLE_NATIVE_TOOL_CALLS` fail-close. Injected-note live graph also passed. Both candidate slots currently use Jonah (same window); comparison is legal, not yet a meaningful trade-off. Eugene publication/readiness review and a coordinator click-through on `/desk` remain for G1 exit.
  - 20 Sep, member 1: publication and readiness review done, and the identical-candidates problem above is fixed. The two profiles now separate on the real board: `sla_first` takes Siti at 22 minutes travel, `minimal_disruption` takes Jonah at 50 percent load pressure. Verified on the deployed box. Only member 4's click-through remains, tracked under G2.
  - 17 Sep: agent-to-plan-endpoint integration implemented on `member-3/g1-planning-integration`; 34 new endpoint tests, 197 passing regression tests, and a compiled loopback HTTP smoke. Platform-owned route/persistence changes require Eugene review, including atomic publication/readiness guards. Real gateway endpoint acceptance and four failing scheduler legality checks still block G1. [Endpoint contract and team requests](team/member-3/planning-endpoint-integration.md).
  - 15 Sep merged latest main `a13a3f2` into member 3 at `71bcdb5` (after the initial `eeeefcb` merge). Profile-batch adapter + platform live-board reader integrated; 157 regression tests pass in both UTC and Asia/Singapore, typecheck and build pass; native-client/actual-graph/actual-scheduler path passes with an HTTP double. Four real legality checks remain failing; platform endpoint still invokes propose directly. [Integration handoff](team/member-3/main-integration.md).
- [x] First Lightsail deploy with `/health` (1) — https://54.179.142.4.sslip.io (Ubuntu 24.04, 4 GB, ap-southeast-1, Caddy + Let's Encrypt)

**G1 exit:** a first-time observer sees the Raffles Place disruption and two legal plans. Insertion only; sidecar may still be stub.

**G1 status 20 Sep (closed):** the four legality checks pass
(`RUN_SCHEDULER_ACCEPTANCE=1`), the validator refuses an unqualified assignee
before the commit guard is consulted, and the two candidates are now genuinely
different. The whole loop was run against the deployed box end to end. Evidence
and the faults found on the way are in
[the stream 1 handover](team/member-1/handover.md), sections 5 and 7.

**G1 status 15 Sep (superseded, kept for the record):** scheduler and platform implementations are on main, but their prior unit-suite passes do not establish legality. The real scheduler acceptance gate fails four checks above. Member 3 has resolved the profile-contract mismatch and reuses platform board data; legal plans, native-agent endpoint wiring, and two-plan desk display still need joint acceptance. Do not advance G1 based on candidate existence or ordinary regression success.

---

## G2 — Controlled commit (Day 10)

- [x] `POST /api/proposals/{id}/decision` and `POST /api/proposals/{id}/commit` (1)
- [x] Stale `sourceSnapshotId` rejected (1) — UC-07 — two proposals race, loser refused, board unchanged
- [x] Medium risk cannot commit without an `approval` row (1 + 3) — UC-12 — enforced and tested in `src/dispatch/commit-policy.ts`. Member 3 now sets `risk` / `autonomyMode` via `classifyProposalRisk()` when planning persists.
- [x] High risk / infeasible: no commit path (2 + 3) — UC-02, UC-06 — blocked even with an approval on file; a plan whose `validations.ok` is false is refused.
  - 20 Sep: member 2's validator now sets that flag for real. An assignment Stage A excludes for tier, missing certificate and expired certificate is refused with `MISSING_CERT` and `CERT_EXPIRED` instead of committing. This closed the release blocker recorded in handover v1.1.
- [ ] Desk: compare, approve/reject with reason, new snapshot on the board (4)
  - 20 Sep, member 1: the code is on main (`ab85524`) and deployed. `desk-api.ts` calls the published handlers and re-derives nothing, and `DeskApiError` surfaces both the refusal code and its detail. What is missing is a human click-through: raise the event, compare, approve with a reason, commit, see v2. Member 4 ticks this, not member 1.
- [x] `POST /api/demo/reset` idempotent to Eastwind Tuesday (1) — UC-10 — commit, then five resets, identical board each time
- [x] Risk policy data: AUTO / APPROVAL / BLOCK (3)
  - 19 Sep: `classifyProposalRisk()` in `src/agent/policy/risk.ts` writes `risk` / `autonomyMode` from stored plan evidence (not a prompt). Empty/invalid/cert/excessive-OT → `block`; new assignment / reassignment / window move / overtime → `approval`; unchanged board → `auto`. Planning persists that classification and audits `classify_risk`.

**G2 exit:** urgent job through approval to a new versioned snapshot. No P1 technician page until this is green.

**G2 status 14 Sep:** every stream 1 item is done and tested (40 unit tests).
The write path is `src/dispatch/commit-policy.ts` (pure decision) and
`src/dispatch/commit.ts` (the only caller of `createSnapshot` in the codebase).
Endpoints, refusal codes, invariants, the faults found so far and the per-stream
asks are consolidated in
[`docs/team/member-1/handover.md`](team/member-1/handover.md).

19 Sep update: PR #8 is merged on main (`419a0a6`), so the planning endpoint now invokes
the native agent graph and persists its accepted candidates with stored recommendation IDs.
G1 still requires Eugene's publication/readiness review and a coordinator click-through on `/desk`.
Live gateway planning on 19 Sep produced two legal Raffles candidates (see G1 agent evidence). Both slots currently assign Jonah. Risk classification is implemented in `src/agent/policy/risk.ts`.

---

## G3 — Feature complete (Day 14)

- [x] Sidecar implements `propose()` for `technician_unavailable` and `job_overrun` (2)
- [x] Insertion is 10 s timeout fallback only on those events (2)
- [x] UC-03: in-progress stays; remaining jobs replan as a set
- [x] UC-04: 45-minute overrun; frozen horizon
- [ ] Five frozen violation codes have no rule behind them (2) - `OUTSIDE_SHIFT`, `TRAVEL_INFEASIBLE`, `LOCKED_MOVED`, `MISSING_PARTS`, `EXCESSIVE_OVERTIME`. A plan that breaks one of these validates clean. `MISSING_PARTS` and `OUTSIDE_SHIFT` are checked by Stage A but not independently afterwards, which is the shape of the bug that produced the G2 release blocker. `EXCESSIVE_OVERTIME` is matched by `classifyProposalRisk` and emitted by nothing, so that branch cannot fire. Pinned in `src/shared/config/violation-vocabulary.test.ts`; delete an entry from `UNIMPLEMENTED` when its rule lands. Context: [handover 5.4](team/member-1/handover.md).
- [ ] Review the profile objective reading in `propose()` (2) - member 1 changed `sla_first` to lead on lateness then travel, and `minimal_disruption` on jobs moved then load pressure, because the shared weights make a weighted sum identical across profiles for a pure insertion. The reading is defensible but it is a reading, and it is member 2's call. Context: [handover 6.1](team/member-1/handover.md).
- [ ] Review the `retryable` change to `planning-errors.ts` (3) - a dependency failure that wrote no proposal row now returns the event to the status it arrived with, instead of leaving it `FAILED` and unplannable for ever. This moved three assertions in `evals/x-suite/planning-endpoint.test.ts` from `FAILED` to `RECEIVED`. Their intent is untouched; the event status is the only thing that differs. Context: [handover 5.2](team/member-1/handover.md).
- [ ] Surface the new planning refusal codes on the desk (4) - `gateway_unavailable` (503), `planning_timeout` (504), `scheduler_timeout` (504), `planning_in_progress` (409), `stale_planning_context` (409), `event_not_plannable` (409), `proposal_exists` (409), `unsupported_event_type` (422), `invalid_event_context` (422). The first three are retryable: the same request works once the dependency recovers, so a retry affordance belongs on exactly those and nowhere else. `solverTrace` now carries `objective`, `loadPressure` and a `considered` array with every technician's numbers, which is what the trace drawer needs to show why rather than assert it. Context: [handover 6.3](team/member-1/handover.md).
- [ ] Agent: compare, explain from evidence, interrupt, resume; playbooks for all three events (3)
- [ ] Desk: unavailable + overrun simulators; trace drawer (4) — UC-13
- [ ] G/A/X: E01–E04, E06–E08 must-pass; E09–E10 safe behaviour (2 + 3)
- [ ] Injection quoted, no assign (3) — UC-05
- [ ] Gateway-down still calls `propose()`; copy does not claim the model ran (3) — UC-08

**G3 exit:** freeze features. Cut OpenClaw/map if they are still ideas.

---

## G4 — Release candidate (Day 18)

- [ ] Five consecutive successful runs after reset (1 + 4)
- [x] Snapshot backup + rollback drill (1)
  - 20 Sep: snapshot taken after the `b8bae2d` deploy and restored to a new instance. Docker was `enabled` at boot and all four containers came up on their own (`Up 7 seconds`, nothing typed), with `.env` and the Postgres volume intact. The static IP move was not attempted: the sandbox account reaps any second Lightsail instance, so the restored box is destroyed within minutes. See handover section 7.3.
- [ ] Five timed 30-minute rehearsals (4 + 3) — rundown in plan §12
- [ ] Backup recording of urgent-job spine (4)
  - 20 Sep, member 1: raise the priority of this. The lease takes the instance, the URL and the TLS certificate together on ~28 Sep, and the sandbox account has now been observed shutting down and deleting compute on its own schedule without warning. The recording is the only artefact that survives either. See [handover 7.3](team/member-1/handover.md).
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
