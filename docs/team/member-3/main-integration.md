# Member 3: main merge and scheduler integration

Owner: Deen. Verified locally on 15 September 2026.
Branch: `member-3/gateway-urgent-agent`. Checklist: [tasks.md](../../tasks.md).

## Git history and recovery point

- `0aeb24a`: checkpoint of the existing native gateway, graph, tests and smoke evidence.
- `backup/member-3-before-main-0aeb24a`: local backup branch naming that checkpoint.
- `2effe25`: initial merge of main at `eeeefcbc572d7b5c046ed421519d1f3aa953d1cf`.
- `76399ea`: agent profile/board integration, regression coverage and legality gate.
- `71bcdb5`: merged the newer main `a13a3f29f60887f391ee893b7fa1a4c88d212945`,
  including the host-timezone fix and stream 1 handover published during this work.

This main revision includes Damon's five scheduler commits and Eugene's
`9e1a0c5` planning/write-path fixes. No merge conflicts occurred. No push or deploy
was performed, and no environment-file values were changed or committed.

## Agent integration changes

`src/agent/tools/scheduler-profile.ts` adapts the current batch-returning scheduler
to the graph's explicit per-profile calls. It validates the entire returned batch
before selecting the requested profile, including the profile being discarded.
It rejects duplicate IDs, foreign snapshots, excessive counts and missing requested
profiles. It does not invent or repair metrics, reorder rankings, change assignments,
change the scheduler's recommendation, or weaken the graph's checks.

`createUrgentTools()` now uses Eugene's `buildBoardSchedule()` instead of rebuilding
the board from snapshot blobs. The agent receives the same live assignments, travel,
certificates, shifts and requirements as the platform. Explicit empty eligibility
collections stay empty, so the scheduler cannot silently use fixture certificates.

The normalized urgent job and `affectedIds` must agree. A canonical context fingerprint
invalidates results when live rows, certificates, shifts, requirements, event data or
notes change between turns, even if the snapshot ID does not change. Collection row
order alone does not invalidate a run. The final validation is followed by another
context check before candidates are released. This is not a database transaction;
atomic reads/commit concurrency remain platform responsibilities.

## Verification and the critical distinction

The final offline regression completed with **157 passed, 7 skipped, 1 TODO**
in each of `TZ=UTC` and `TZ=Asia/Singapore`, after the second main merge.
TypeScript checking and the production build passed. Fourteen added integration tests
cover the profile adapter, shared board data, native-client-to-real-graph dispatch with
the real main scheduler/validator, preserved backend evidence, and context changes.
The HTTP/model response in that joined-up test is a double; no gateway call is made.

The seven default skips are three opt-in live gateway tests and four opt-in real
scheduler legality assertions. The remaining TODO is G2 recommendation acceptance.
**Default regression success is NOT scheduler legality acceptance.**

The explicit legality command was rerun after the second merge in UTC and
**failed all four checks** (exit code 1; report preserved):

| Check | Observed on latest merged main `a13a3f2` |
|---|---|
| Raffles customer window | Both plans use 11:00–12:30 instead of respecting 13:00–17:00; validator accepts. |
| Independent certificate check | Changing the candidate assignee to unqualified Wei still passes validation. |
| Required carried part | Stage A accepts Siti after removing the required inverter board from her parts. |
| Missing shift | Stage A accepts a technician when no shift record is supplied. |

Evidence: [scheduler-acceptance-1789457318062.json](scheduler-acceptance-1789457318062.json).
These assertions deliberately fail until the upstream constraints are implemented;
they are not `it.fails()` tests, and failures are never converted into passing evidence.
The test uses only the memory database and writes a sanitized report beside this file.

Reproduce the independent G1 acceptance gate (no gateway quota):

```sh
RUN_SCHEDULER_ACCEPTANCE=1 npx vitest run evals/a-suite/real-scheduler.acceptance.test.ts
```

Ordinary regression and build, without live requests:

```sh
RUN_GATEWAY_SMOKE=0 RUN_AGENT_GATEWAY_SMOKE=0 RUN_SCHEDULER_ACCEPTANCE=0 npm test
npm run typecheck
npm run build
```

## Handoff and gate status

G0 is closed using the owner's earlier reviewed native-protocol and live graph reports.
Those live graph runs used scheduler/validator doubles; they were not rerun after this
merge, and no new live gateway requests were made during this integration pass.
G1 stays open: the Stage A and legal-plan checkboxes have been reopened with the four
reproducible failures rather than claiming the previous unit-suite passes prove safety.

Damon owns the scheduler/validator corrections exposed by the acceptance gate.
Eugene's merged endpoint already persists proposals and stored recommendation IDs,
but still calls `propose()` directly; it does not invoke `runUrgentJobAgent()` yet.
The existing exported `createUrgentTools(db)` and `runUrgentJobAgent({ eventId, tools,
model })` are the agent-side integration boundary for that platform change. The desk
must still show two legal plans before G1 can close. None of those other stream files
was rewritten by this agent integration pass.

The graph still cannot approve, assign or commit. Its `candidates_ready` status means
that the currently configured scheduler and validator returned candidates, not that
the known-incomplete upstream validator has somehow become complete. Do not present
that status as full legality or deployment acceptance. Risk classification, durable
approval interrupt/resume and other G2/G3 work have not been started ahead of G1.
