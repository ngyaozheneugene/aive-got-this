# G1 planning endpoint integration — platform review required

Owner: Deen. Prepared 17 September 2026 from `main@7d00162`.
Branch: `member-3/g1-planning-integration`.
Completion checklist: [docs/tasks.md](../../tasks.md). This is an integration handoff, not a second task board.

## Implemented boundary

`POST /api/events/{id}/plan` now calls `planUrgentEvent()` in `src/dispatch/plan-event.ts`.
That function invokes the existing `runUrgentJobAgent()` and default native gateway client.
The graph still owns retrieve -> propose both profiles -> independent validation.
Platform saves only the graph's accepted candidates, records stored recommendation IDs after
saving, and publishes the event as `PROPOSAL_READY` only after the successful persistence path.
No scheduler, validator, shared domain schema, commit or decision code was rewritten.
The route and new dispatch files are cross-stream integration changes awaiting Eugene's review.

Assignments, snapshots and approvals are not written by planning. The service stores the actual
graph trace through `IDatabase.decisionLogs`; it does not store assistant prose or gateway secrets.
The final `persist_proposal` entry is a platform operation, NOT an additional model-advertised tool.
It maps scheduler IDs to stored candidate IDs. A server-only source-context fingerprint is checked
again before and during persistence; it is never returned as an authorization token to the browser.

## HTTP contract for platform and desk review

Request: empty body, `{}`, or `{ "profile": "sla_first" | "minimal_disruption" }`.
Default profile: `sla_first`. Unknown fields are now rejected; body limit: 2048 bytes.
Only `urgent_job` is integrated in this change. Unavailable/overrun return 422 rather than silently
passing through urgent insertion. Adding their graph/sidecar path is separate G3 work.

Successful HTTP 201 preserves `{ proposal, plans, engine, timedOut }` and adds:

- `comparisonReady`: accepted candidates cover both profiles. One accepted profile is NOT a comparison.
- `selectionBasis`: `requested_profile`, or `available_validated_plan` when only the other profile survived.
- `agent`: `{ runId, protocol, modelCalls, status: 'candidates_ready' }`.

`recommendedPlanId` names an actual stored candidate. Selection preserves the requested profile;
it is NOT metric ranking or a model recommendation. G2 ranking/classification is still unfinished.
Risk stays at the existing G1 `medium` / `approval` default. This default is not a safety validator.
The desk must not describe identical alternatives or known-incomplete validation as proven legality.

Errors keep the `{ error, detail }` envelope; no arbitrary exception or provider body is returned.

| HTTP | Codes / behavior |
|---|---|
| 400 | `invalid_json`, `invalid_event_id`, `invalid_plan_request` |
| 404 | `event_not_found` |
| 408 | `planning_cancelled` |
| 409 | `planning_in_progress`, `event_not_plannable`, `proposal_exists`, `stale_planning_context`, `no_candidate_plans` |
| 413 | `request_too_large` |
| 422 | `unsupported_event_type`, `invalid_event_context` |
| 502 | `agent_failed` |
| 503 | `gateway_unavailable`, `scheduler_unavailable` |
| 504 | `planning_timeout`, `scheduler_timeout` |
| 500 | `planning_failed`, `planning_cleanup_failed` |

An empty timed-out solver result is FAILED, not INFEASIBLE. Completed empty validation is INFEASIBLE.
A terminal/failed/superseded event is not silently reused; raise a new event against the current board.
Request cancellation is forwarded into the graph. Gateway failure currently returns an honest failure;
G3 structured fallback is deliberately not represented as implemented. The graph budget is 90 seconds;
`maxDuration=120` is declared on the route, but the real server/proxy timeout still needs confirmation.

## Verification and limits

34 new endpoint tests exercise the real route, native client, graph and persistence. Most use scheduler
and validator doubles; one exercises the real main scheduler/validator. All use a fake model response.
The full regression currently has **197 passed, 7 skipped, 1 TODO**; typecheck and production build pass.
The seven skips are three opt-in gateway tests and the four separate scheduler legality assertions.

The compiled HTTP smoke starts a new Next.js process with its own in-memory DB and a loopback-only
synthetic gateway. It verifies cross-route state, five native model requests, stored IDs, audit order,
unchanged board, duplicate refusal and gateway-failure handling. Seven checks passed; six loopback
requests total (five success calls and one deliberately rejected request). It uses no real API key.
Evidence: [planning-http-smoke-1789614392261.json](planning-http-smoke-1789614392261.json).

The real scheduler legality gate was separately rerun and **all four checks still fail**:
customer window, independent certificate validation, required carried part, missing shift.
Evidence: [scheduler-acceptance-1789614489860.json](scheduler-acceptance-1789614489860.json).
No G1/G2 completion, real-gateway endpoint acceptance, sidecar runtime, SQL transaction or deployment
acceptance is claimed. No paid gateway request was made by this integration work.

## Persistence/concurrency review: do not treat the tests as a transaction

`IDatabase` has no transaction or atomic event-claim primitive. The duplicate guard only covers the same
DB instance in this process. Other workers and concurrent decision/commit handlers are NOT locked.
Publication creates GENERATING records first; partial failures invalidate the proposal best-effort.
If invalidation also fails, the service returns `planning_cleanup_failed`, not fabricated rollback.
Partial rows are retained, not deleted. Context rechecks narrow races; they do not close them atomically.

**Before live enablement, Eugene must review atomic publication and decision/commit readiness.** The
existing decision function only rejects COMMITTED state, so it can action incomplete or invalidated
proposals. The current commit guard does not reject GENERATING explicitly. This change does not fix
those existing lifecycle rules, and must not be presented as safe under concurrent approval/publication.
A readiness/CAS/transaction change belongs in platform, not a duplicated eligibility implementation.

## Reproduce

```sh
RUN_GATEWAY_SMOKE=0 RUN_AGENT_GATEWAY_SMOKE=0 RUN_SCHEDULER_ACCEPTANCE=0 OPTIMIZER_URL=http://127.0.0.1:1 TZ=UTC npm test
npm run typecheck
npm run build
node evals/a-suite/planning-http-smoke.mjs
RUN_SCHEDULER_ACCEPTANCE=1 npx vitest run evals/a-suite/real-scheduler.acceptance.test.ts
```

The last command is expected to FAIL until the four upstream constraints are fixed. Do not weaken it.

## Requests to send (not sent automatically)

These messages refer to `member-3/g1-planning-integration` (implementation commit `db4406d`).
The implementation is present; the requests are for review, remaining fixes and acceptance, not a rebuild.

**Eugene — platform review and safe publication**

> The urgent planning endpoint now invokes the native agent and persists accepted candidates, stored IDs and its tool trace. Please review `src/app/api/events/[id]/plan/route.ts`, `src/dispatch/plan-event.ts` and `src/dispatch/planning-errors.ts` on `member-3/g1-planning-integration`. Before live use, can you close the decision/commit readiness guards so GENERATING, rejected or superseded proposals cannot be approved or committed, and confirm an atomic publication/event-claim approach? Please also confirm the planning timeout and enable the offline A/X endpoint suites in PR CI. No eligibility rules or schedule-commit implementation were duplicated. Please send the review or follow-up PR so we can test the combined path.

**Damon — scheduler legality acceptance**

> The new sidecar work is pulled, but all four G1 legality checks still fail on `main@7d00162`: customer window, independent certificate validation, required carried parts and absent shift. Please run `RUN_SCHEDULER_ACCEPTANCE=1 npx vitest run evals/a-suite/real-scheduler.acceptance.test.ts`, fix these in Stage A/scheduling/validation, and share the branch or PR with passing evidence. Please also verify meaningful legal alternatives when a trade-off exists and tell me about any proposed profile-return or planning-data contract changes. The agent currently validates both returned profiles and selects the requested one without changing scores or assignments. These fixes are still needed despite the new G3 code.

**Khant — desk branch and API integration**

> Please share or push your desk branch/PR and review the HTTP contract in `docs/team/member-3/planning-endpoint-integration.md`. Use stored proposal/plan IDs and backend metrics, support loading/failure/superseded states, and display one-plan results honestly when `comparisonReady=false`. Selection is requested-profile based, not AI ranking. Please keep unavailable/overrun out of the urgent-only endpoint until their playbooks are integrated. After Eugene's readiness review and Damon's legality fixes, let's verify the real-gateway-to-desk urgent flow together.
