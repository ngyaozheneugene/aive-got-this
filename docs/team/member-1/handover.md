# Stream 1 handover v1.5

**Author:** Eugene (member 1, platform and data)<br>
**Date:** 20 Sep 2026 (Day 12)<br>
**Status:** Current as of `main` at `b8bae2d`, which is deployed and verified end to end on the box. The release blocker recorded in v1.1 is closed. Read alongside the brief in [`README.md`](README.md) and the board in [`../../tasks.md`](../../tasks.md).

Everything stream 1 has built, deployed, and found, in one place. Read this before working on anything that stores, approves, or commits a schedule, and before pointing a desk or an agent at the API. Section 5 records the blocker that is now closed and the three faults found while closing it. Section 6 lists what each of the other three streams needs to know or do.

---

## 1. What is running

The product is deployed, public, and serving the seeded Eastwind Tuesday board over HTTPS.

| Item | Value |
|---|---|
| URL | `https://54.179.142.4.sslip.io/desk` |
| Host | Lightsail, Ubuntu 24.04, 4 GB / 2 vCPU, `ap-southeast-1` |
| TLS | Caddy with a Let's Encrypt certificate, valid to 13 Dec 2026, renews unattended |
| Containers | `aive-caddy`, `aive-app`, `aive-postgres`, `aive-optimizer` |
| Database | In-memory adapter (`USE_MEMORY_DB=true`). Postgres runs but is unseeded |
| Gateway | Configured server-side; `LLM_MODEL=global.anthropic.claude-sonnet-4-5-20250929-v1:0` |

The box tracks `main`. To redeploy after a merge, in three steps:

```bash
cd ~/aive-got-this && git checkout main && git pull
```

```bash
docker compose build app && docker compose build optimizer
```

```bash
docker compose up -d --force-recreate app optimizer
```

> **Warning:** `docker compose up -d --build` is not reliable here, and the
> failure is silent. On 20 Sep it rebuilt both images correctly and left both
> containers running the previous ones, reporting success. The site was
> unchanged for four days' worth of merges and nothing in the deploy output said
> so.
>
> The cause is worth knowing. A container is an instance created from an image;
> rebuilding an image does nothing to a container that already exists. Compose
> normally notices and recreates, but the new build takes the `:latest` tag from
> the old image, which then becomes dangling. The running containers referenced
> that now-untagged digest, compose compared them against it, found them
> consistent, and correctly answered a question nobody meant to ask.
> `docker compose ps` shows the symptom: a bare `sha256:...` in the `IMAGE`
> column instead of a name.
>
> `--force-recreate` removes the guesswork. Naming `app` and `optimizer`
> explicitly leaves `caddy` and `postgres` alone, so the certificate and the
> volumes survive.

After deploying, check the running build rather than the page, because a browser
will happily show you a cached one:

```bash
curl -s https://54.179.142.4.sslip.io/api/events/x/plan -X POST \
  -H 'Content-Type: application/json' -d '{"profile":"invented"}'
```

`invalid_plan_request` is the current build. `invalid_profile` is the pre-agent
one.

> **Note:** the AWS lease and the submission deadline both land around 28 Sep 2026, which falls before the plan's Day 21 row. When the lease ends, the instance, the URL, and the certificate go with it. The G4 backup recording is the only artefact that outlives it.

---

## 2. What stream 1 built

### 2.1 Infrastructure

`docker-compose.yml` originally defined Postgres and the optimizer only, which is correct locally where Next.js runs under `npm run dev`. The box has no Node, so the whole stack had to be containers. As a result the compose file now carries a fourth service, `app`, built from the root `Dockerfile`, plus `caddy` terminating TLS.

- **Service-name networking.** Inside the Compose network, `localhost` means the container itself. The `app` service therefore overrides `DATABASE_URL` and `OPTIMIZER_URL` to reach `postgres:5432` and `optimizer:8081` by service name. Your `.env` keeps saying `localhost` because that is correct when you run `npm run dev` outside the containers.
- **One TLS switch.** `SITE_ADDRESS` in `.env` decides everything: `":80"` serves plain HTTP with no certificate request, which is the local default; a hostname triggers automatic Let's Encrypt issuance and renewal. The box uses `54.179.142.4.sslip.io`, because `sslip.io` resolves any IP embedded in the name back to that IP, which is enough for the ACME challenge on a box with no domain.
- **Certificates persist in a named volume.** Never run `docker compose down -v`; that deletes the volumes, taking the certificate and the Postgres data with them.

### 2.2 The write path

The commit path is split in two so that the decision is testable without any I/O.

| File | Job | Knows about |
|---|---|---|
| `src/dispatch/commit-policy.ts` | Decides whether a plan may commit | Nothing. Pure |
| `src/dispatch/commit.ts` | Performs the commit | The database |
| `src/dispatch/decision.ts` | Records a desk verdict | The database |
| `src/dispatch/board-schedule.ts` | Answers "what is on the board" | The database |
| `src/app/api/**/route.ts` | Translates HTTP to those functions | Requests, status codes |

`checkCommit` reads nothing but its arguments: no HTTP, no database, no clock, no randomness. Consequently the whole suite runs in under a second, and the same logic works unchanged whether the desk calls it through a route or member 3 wraps it as a tool.

> **Warning:** `src/dispatch/commit.ts` is the only caller of `boardSnapshots.createSnapshot` in the codebase. Nothing else may write a `board_snapshot`. If you need the board to change, go through the commit path.

### 2.3 Data layer additions

Three methods were added to `IDatabase` and implemented in both adapters.

| Method | Why |
|---|---|
| `decisionLogs.listByEvent(eventId)` | Backs `GET /api/events/{id}/audit`, which previously returned a hardcoded empty array |
| `assignments.supersede(id, status)` | Retires a row without deleting it. `current-board.ts` counts an assignment as live when its status is `accepted` or `offered`, so a reassignment without this would show the job against both technicians |
| `approvals.getByProposal(proposalId)` | The commit guard reads the newest decision row for a proposal |

---

## 3. Contracts you can rely on

### 3.1 Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/schedule/current` | Committed snapshot, technicians, jobs, assignments |
| `POST` | `/api/events` | Create a disruption event |
| `GET` | `/api/events/{id}` | One event |
| `POST` | `/api/events/{id}/plan` | Run `propose()`, store proposal plus candidate plans |
| `GET` | `/api/proposals/{id}` | Proposal and its candidate plans |
| `POST` | `/api/proposals/{id}/decision` | Record approve or reject |
| `POST` | `/api/proposals/{id}/commit` | Commit a plan as a new snapshot |
| `GET` | `/api/events/{id}/audit` | Ordered `decision_log` for the trace drawer |
| `POST` | `/api/demo/reset` | Restore the canonical Tuesday |
| `GET` | `/health` | App, database mode, optimizer, gateway |

Request bodies are the Zod schemas frozen at G0 in `src/shared/contracts/tools.ts`. Fields outside those schemas are stripped and never reach the guard.

### 3.2 Refusal codes

Every failure returns `{ "error": "<code>", "detail": "<sentence>" }`. The codes live in `src/shared/config/reason-codes.ts` as `COMMIT_REJECTIONS`. Render the code; the `detail` is a human sentence and is safe to display.

| Code | HTTP | Means |
|---|---|---|
| `proposal_not_found`, `plan_not_found` | 404 | No such row |
| `plan_not_in_proposal` | 400 | That plan belongs to another proposal |
| `already_committed` | 409 | This proposal already produced a snapshot |
| `proposal_rejected` | 409 | The desk rejected it. Needs a new proposal, not a retry |
| `validation_failed` | 409 | The validator refused the plan; `detail` names the violations |
| `snapshot_mismatch` | 400 | Caller named a baseline this proposal never used. Client bug |
| `stale_snapshot` | 409 | The board moved on. Re-plan, then retry |
| `approval_required` | 403 | Medium risk with no approved row covering this exact plan |
| `commit_blocked` | 403 | High risk. No commit path exists |

> **Note:** `stale_snapshot` is the only code worth an automatic retry, and only after re-planning. The rest need a human or a code fix.

### 3.3 Invariants

- **A refused commit changes nothing.** The board version is identical afterwards. Every refusal test asserts this.
- **Authorisation comes from the stored `approval` row, never from the request.** A body carrying `approved`, `force`, or `skipApproval` is rejected by Zod before any code runs.
- **Assignment rows are the source of truth for the board**, not `board_snapshot.snapshotData`. See §4.2.
- **`decision_log` is append-only** and ordered by `sequence`, then `created_at`. Both adapters order identically.
- **`plan.assignments` is applied as the slots the plan asserts.** Jobs a plan does not mention keep their technician, and slots identical to the live row are skipped, so the audit trail describes the real change.

---

## 4. Faults found, and what they teach

Five faults were found by running the joined-up path rather than by any stream's own tests. Each stream's tests passed throughout, because no test crossed a stream boundary.

### 4.1 Every route had its own database

`src/db/index.ts` kept the instance in a module-level variable. Next.js compiles each route handler into its own bundle, so that singleton was instantiated once **per route**:

```text
POST /api/events        -> opev_..._1   (created)
GET  /api/events/{id}   -> 404 not_found
POST /api/events x3     -> _1, _2, _3   (within one route, state persists)
any other route         -> own counter, restarts at _1
```

An event created by one endpoint was invisible to the next. The fix moves the instance onto `globalThis`, which is shared across bundles and survives hot reloads.

> **Why this hid for so long:** unit tests construct `InMemoryDatabase` directly, and every live check we had run was single-route. `POST /api/demo/reset` followed by `GET /api/schedule/current` both reported v1, which looks like success but proves nothing: two independent databases sitting at v1 are indistinguishable from one shared database.

### 4.2 Two sources of truth for the board

The plan route read `snapshot.snapshotData.assignments` and `.travel`. The seeded v1 snapshot carries only assignment ids:

```ts
snapshotData: { date: EASTWIND_DATE, assignmentIds: assignments.map(a => a.id) }
```

Both therefore came back empty, so `propose()` planned against an empty board and `travelMinutes` threw `TRAVEL_MATRIX_MISSING` on the empty matrix. Meanwhile `current-board.ts` reads assignment rows, so the desk and the planner disagreed about the same board.

`src/dispatch/board-schedule.ts` is now the single answer, reading live rows. The snapshot keeps the job it is good at: its id is what `checkCommit` compares for staleness, which never needed the contents.

### 4.3 The recommendation named a plan that did not exist

The plan route set `recommendedPlanId` from `propose()`'s own generated id, then saved the plans, and `candidatePlans.create` assigns the real stored id. Approving without naming a plan, which is the desk's common action, fell back to that dangling id and returned 404. The recommendation is now recorded after saving.

### 4.4 The job date came from the wall clock

`event.receivedAt.substring(0, 10)` meant the plan endpoint only found jobs on the one calendar day `EASTWIND_DATE` happens to name. It now uses `EASTWIND_DATE`.

### 4.5 `isPeakHour` depended on the host timezone

`Date.getHours()` returns the host machine's local hour, so peak detection answered correctly only on a machine set to `Asia/Singapore`:

```text
Asia/Singapore  ->  getHours() for 08:30+08:00 = 8   -> peak      (our laptops)
UTC             ->  getHours() for 08:30+08:00 = 0   -> not peak  (CI, and the box)
```

This kept `main` red for two and a half hours, but the CI failure was the lesser problem. The Lightsail box runs UTC too, so peak-hour travel times would silently never have triggered on the deployed demo. It now reads the wall-clock fields from the timestamp, which is valid because product times are ISO 8601 with an explicit `+08:00` offset.

> **Why:** any test that reads the host clock or timezone passes for whoever wrote it and fails for everyone else. By contrast `validate.ts` is fine, because it compares absolute `getTime()` values, which are offset-independent.

---

## 5. The release blocker is closed, and what closing it turned up

v1.1 recorded an assignment that Stage A excluded on three separate grounds,
which nonetheless passed the independent validator, passed the commit guard, and
landed on the board. Member 2 closed it in `1023f25`. Verified independently by
stream 1 against the same fixture, same technician, same job:

```text
                 v1.1 (main 2560304)        now (main 7089fe5)
Stage A on Wei   eligible=false             eligible=false
validatePlan()   ok=true   violations=[]    ok=false  MISSING_CERT, CERT_EXPIRED
commitPlan()     ok=true                    refused, validation_failed
board            v2  job_raffles -> Wei     unchanged
```

The legality gate that had four failing checks now passes all four:

```sh
RUN_SCHEDULER_ACCEPTANCE=1 npx vitest run evals/a-suite/real-scheduler.acceptance.test.ts
```

The commit guard itself did not change, and did not need to. It refused the plan
the moment the validator gave it grounds to.

> **Note:** the gate writes a timestamped evidence file into
> `docs/team/member-3/` on every run. It is untracked, so it waits to be swept
> into someone's next `git add -A`. Delete it after running, or add the pattern
> to `.gitignore`.

### 5.1 Fault: the violation vocabulary had drifted in three directions

Three streams read the same violation codes and none of them owned the list, so
each drifted to its own spelling while every suite stayed green:

| Contract froze | Validator emitted | Classifier matched |
|---|---|---|
| `CERT_EXPIRED` | `EXPIRED_CERT` | `CERT_EXPIRED` |
| `DUPLICATE_ASSIGNMENT` | `DUPLICATE_JOB_ASSIGNMENT` | not matched |
| `IN_PROGRESS_MOVED` | `IN_PROGRESS_JOB_MOVED` | not matched |
| `WINDOW_INFEASIBLE` | `WINDOW_VIOLATION` | not matched |
| no such code | `INVALID_CERT` | not matched |

The consequence was quiet rather than dramatic. An expired certificate never
raised its own risk reason in `classifyProposalRisk`, because the code it looked
for was never the code the validator produced. The proposal was still blocked, by
the blunter `validation_failed` rule, so nothing looked broken while the audit
trail named the wrong cause. That is precisely the kind of thing a judge asks
about, and precisely the kind of thing a passing suite will not tell you.

**Fixed.** `src/matching/validate.ts` now emits the frozen codes through a typed
helper, so a code that is not in `VALIDATION_VIOLATIONS` is a compile error
rather than a string that reaches the desk. `INVALID_CERT`, which had no frozen
equivalent, became `MISSING_CERT` with the cause kept in the detail suffix: a
certificate issued after the schedule date means the technician does not hold a
valid one on the day. `src/agent/policy/risk.ts` needed no change, which is the
clearest evidence that the contract, not the classifier, was at fault.

`src/shared/config/violation-vocabulary.test.ts` now compares the three
spellings to each other rather than to a hand-written expectation, so the next
drift fails a test instead of shipping.

### 5.2 Fault: an outage consumed the event permanently

The planning endpoint claims an event by moving it to `PLANNING`, and refuses to
plan anything that is not `RECEIVED` or `VALIDATED`. So whatever status a failure
leaves behind decides whether the coordinator can press the button again.

Reproduced against the real handler with the gateway returning 503 throughout:

```text
POST /api/events/{id}/plan   -> 503 gateway_unavailable   event: FAILED
gateway recovers
POST /api/events/{id}/plan   -> 409 event_not_plannable   event: FAILED
```

Nine seconds of someone else's downtime cost the event permanently. Mid-demo the
only recovery is to raise the whole event again from the simulator.

**Fixed.** `PlanningError` now carries a `retryable` flag. A failure that is
about a dependency rather than the event, and that wrote no proposal row, hands
the event back at exactly the status it arrived with:

| Failure | Event after | Retryable |
|---|---|---|
| `gateway_unavailable`, `planning_timeout`, `scheduler_timeout`, `planning_cancelled`, `scheduler_unavailable` | restored | yes |
| `agent_failed`, `invalid_event_context`, `stale_planning_context`, `no_candidate_plans` | terminal | no |

A run that got far enough to persist a proposal stays terminal whatever the
cause, so partial writes still wait for review rather than being replanned over.
`evals/x-suite/planning-retry.test.ts` pins both halves: an outage is survivable,
and a model that asks to commit is not.

> **Warning:** this changed three assertions in member 3's
> `evals/x-suite/planning-endpoint.test.ts`, from `FAILED` to `RECEIVED`. Each
> test's real intent is untouched: no proposal, no board change, no credential
> leakage, same HTTP status. Only the event status differs. Flagged for member 3
> in section 6.2 because it is a change to his contract, not a bug fix in his
> code.

### 5.3 Fault: the validator silently falls back to demo certificates

`validatePlan` reached for `certs` and `jobRequirements` through a cast and fell
back to the Eastwind fixture when they were absent. A validator that quietly
certifies a plan against demo certificates is worse than no validator, because
it reports `ok: true`.

Production never reaches it. `buildBoardSchedule` supplies all three collections
and is the only path in, and the frozen `boardScheduleSchema` is not applied
anywhere that would strip them. But the fallback is load-bearing in the suite:
making it throw fails sixteen tests across nine files, which means most of the
test suite validates against fixture certificates rather than the schedule under
test.

**Partly fixed.** `BoardSchedule` now declares `certs`, `shifts` and
`jobRequirements` as optional members, so the casts are gone and an omission is
visible to the type checker at the call site instead of being reached through
`as unknown as`. The fixture fallback stays, because removing it is member 2's
call and would rewrite nine test files during the last week.

### 5.4 Frozen codes no rule emits yet

Five of the eleven frozen violation codes still have no rule behind them. A plan
that breaks one of these validates clean:

| Code | Meaning |
|---|---|
| `OUTSIDE_SHIFT` | Slot falls outside the technician's shift |
| `TRAVEL_INFEASIBLE` | Not enough travel time between consecutive slots |
| `LOCKED_MOVED` | A locked job was reassigned |
| `MISSING_PARTS` | Technician does not carry a required part |
| `EXCESSIVE_OVERTIME` | Overtime beyond the configured ceiling |

`MISSING_PARTS` and `OUTSIDE_SHIFT` are checked by Stage A, so an unqualified
technician is filtered out before planning. They are not checked independently
afterwards, which is the gap that produced the original blocker.
`EXCESSIVE_OVERTIME` is matched by `classifyProposalRisk` and emitted by nothing,
so that branch is currently unreachable.

The list is pinned in `violation-vocabulary.test.ts`. Implementing one and
forgetting to update the list fails that test.

> **Why these survived every test suite:** each stream's tests pass. The
> scheduler was tested with hand-built schedules, the commit path with hand-built
> plans, and the agent against doubles. Contract drift only shows when the
> spellings are compared to each other, which is what the new test does.

---

## 6. What each stream needs to know

> **Note:** an `@handle` in a repository file renders as a link but sends no notification. Share this section directly if you need someone to act on it.

### 6.1 Member 2, scheduler (@Requlish)

**The blocker is closed, and it was yours. Thank you.** `1023f25` gave the
validator its own certificate and customer-window checks, and Stage A its
parts, tools and missing-shift exclusions. Stream 1 re-ran the probe from v1.1
and the legality gate: an unqualified technician is now refused before the
commit guard is even consulted. See §5.

**Two things stream 1 changed in `src/matching/`, for your review.** Both are
small and both are covered by tests:

- `validate.ts` now emits the frozen codes from
  `src/shared/config/reason-codes.ts` rather than its own spellings, through a
  typed helper that makes an unknown code a compile error. Your behaviour is
  unchanged; only the strings differ. §5.1 has the before and after.
- `BoardSchedule` now declares `certs`, `shifts` and `jobRequirements`, so the
  `as unknown as` casts in `validate.ts` are gone. Additive, nothing breaks.

**Still open, and it is the last legality gap.** Five frozen violation codes
have no rule behind them: `OUTSIDE_SHIFT`, `TRAVEL_INFEASIBLE`, `LOCKED_MOVED`,
`MISSING_PARTS`, `EXCESSIVE_OVERTIME`. §5.4 lists them. Two are checked by
Stage A but not independently afterwards, which is the same shape as the bug you
just fixed: the filter knows, the validator does not. `EXCESSIVE_OVERTIME` is
matched by member 3's risk classifier and emitted by nobody, so that branch
cannot currently fire.

**The identical-candidates blocker is fixed, in your engine, and it needs your review.** The 20 Sep run on the box returned two candidates identical in all twelve slots. They now separate:

```text
sla_first           job_raffles -> tech_siti   travel 22   load pressure 76
minimal_disruption  job_raffles -> tech_jonah  travel 30   load pressure 50
```

The diagnosis is worth reading before the fix, because the obvious fix would not have worked. For a pure insertion into a free window, `slaLateness`, `overtime` and `jobsMoved` are all genuinely zero for every candidate. That leaves travel and imbalance, and `PLAN_WEIGHTS` gives those two **identical values in both profiles**. A weighted sum therefore makes the profiles arithmetically the same, so both plans land on the same technician no matter how good the metrics are. Computing real metrics alone would have moved both plans to Siti and changed nothing else.

Three things changed in `src/matching/propose.ts`:

- **Travel is measured to the job's own cluster.** It was hardcoded to `'cbd'`, which is correct for Raffles Place and wrong for the other eleven jobs on the board. `BoardSchedule` now carries `sites`, which is where `estateCluster` lives, and `buildBoardSchedule` supplies them.
- **Metrics are computed instead of hardcoded.** `slaLatenessMinutes`, `overtimeMinutes`, `jobsMoved` and `unassignedCount` were literal zeros and `customersAffected` a literal `1`, so the desk compared two candidates on constants. Whichever technician was chosen, the metrics table read the same.
- **Each profile leads with its own objective**, falling back to the weighted blend only to break ties. `sla_first` minimises lateness then travel, which reads as soonest on site. `minimal_disruption` minimises jobs moved then load pressure, which reads as least knock-on. Load pressure is the share of the technician's `maxMinutesDay` the job consumes, penalised when `acceptsOt` is false, because a technician who is two thirds full and will not work late is where a late job becomes tomorrow's problem.

`solverTrace` now carries the objective, the load pressure and every technician considered with their numbers, so member 4's trace drawer can show why rather than asserting it.

> **Note:** the third change is a design decision in your territory. The reading of each profile name is defensible but it is a reading, and you may prefer another. The first two are straightforward defects. All three are covered by four new tests in `evals/g-suite/g02-profiles.test.ts`.

**Your G-02 eval passed throughout.** It counts plans and checks a status, so it was green while both candidates were the same plan twice. It now asserts they differ, that the profiles separate on their own objective, that metrics are not placeholders, and that travel tracks the job cluster. The G1 exit line calls for "two meaningfully different valid candidates", and the 30-minute rundown has a beat comparing SLA-first against minimal-disruption. As things stand, the desk would show the same plan twice. Two likely causes in `src/matching/propose.ts`:

- Travel is computed to a hardcoded `'cbd'` destination rather than the job's actual cluster, so travel is constant across technicians and stops discriminating between them.
- Start times use a placeholder estimate, `9 + assignmentCount * 2` hours, rather than real insertion into gaps.

**The fixture fallback is still load-bearing, and only you can retire it.** `validatePlan` falls back to the Eastwind fixture when a schedule omits `certs` or `jobRequirements`, which means it can report `ok: true` against demo certificates. Production never reaches it, because `buildBoardSchedule` always supplies them. But making the fallback throw fails sixteen tests across nine files, so most of the suite is validating against fixture data rather than the schedule under test. `BoardSchedule` now declares the three collections, so the fix is mechanical: give those fixtures their certs and delete the `??`.

**For information.** `propose()` returns the whole day, so a one-job insertion carries twelve unchanged slots. The commit path skips no-op slots, so this is harmless for the board and the audit trail. It does mean a trace drawer rendering `plan.assignments` will show twelve rows for a one-job change; rendering `changeSet` avoids that.

**On ownership.** `src/app/api/events/[id]/plan/route.ts` is stream 1's folder. Unblocking yourself there was reasonable, but it meant nobody with the write path's context reviewed it, and three of the five faults in §4 were in that file. Ping stream 1 next time and it will be quicker.

### 6.2 Member 3, agent (@Deen11)

**The classifier is accepted and the hardcoded default is gone.** `classifyProposalRisk` derives risk from stored plan evidence rather than asking the model, which is what makes `checkCommit` mean anything: the guard takes the stricter of `RISK_POLICY[risk]` and the stored `autonomyMode`, so if `risk` were a model's guess the whole fail-closed design would rest on one. It is not. Nothing in `src/dispatch/` needed to change to accept it.

**Your cert branch was unreachable, and the contract was at fault, not your code.** `classifyProposalRisk` matched `CERT_EXPIRED`; the validator emitted `EXPIRED_CERT`. An expired certificate therefore never raised `missing_or_expired_cert`, only the blunter `validation_failed`. Same risk level, wrong audit reason. Fixed in the validator, so `risk.ts` is untouched. Details in §5.1.

**Three assertions changed in `evals/x-suite/planning-endpoint.test.ts`, and that needs your agreement.** A sustained gateway outage left the event `FAILED`, and since the endpoint only plans `RECEIVED` or `VALIDATED` events, the event could never be retried once the gateway recovered. Stream 1 added a `retryable` flag to `PlanningError`: a dependency failure that wrote no proposal row now restores the event to the status it arrived with, while anything about the event itself, and any partial write, stays terminal. §5.2 has the table and the reproduction. Your tests' real intent is untouched, only the event status assertion moved from `FAILED` to `RECEIVED`.

**Your commit is not on `main` yet.** `4bf023b` is on `eugene` and `member-3/risk-classifier`. Eugene is holding it for a single PR once the branch is complete.

**The commit logic is callable directly.** `commitPlan(db, input)` and `recordDecision(db, input)` in `src/dispatch/` take a database and a plain object. Wrap those as tools rather than calling the HTTP routes from inside the graph.

**`decision_log` is what the trace drawer reads.** Write entries with an `eventId` and a `sequence`; `listByEvent` orders by `sequence` first, then `created_at`.

**No deployment change is needed for your work.** `readGatewayConfig` reads `LLM_GATEWAY_URL`, `LLM_GATEWAY_API_KEY` and `LLM_MODEL`, which are exactly the names already in `.env` and on the box. Your runbook's warning not to rename the model variable and Eugene's Day 1 decision to keep the organiser's spelling agree.

**One operational consequence worth naming.** Planning now makes roughly five live gateway calls per request, where it used to be local arithmetic. The demo depends on `api.softwaresystems.app` being reachable from the box. The retry fix in §5.2 means an outage is survivable rather than fatal, but it is still a dependency the 30-minute rundown did not have last week.

### 6.3 Member 4, desk (@KhantPS)

**The desk landed and the ownership line is right.** `desk-api.ts` calls stream 1's handlers and re-derives nothing, and `DeskApiError` carries both the code and the detail through to the screen, so the refusal codes in §3.2 are visible to a human instead of being flattened into a generic failure. That is the behaviour the safety story depends on.

**Risk is now real, so the desk can show it.** `proposal.risk` and `proposal.autonomyMode` are computed from plan evidence rather than hardcoded to `medium` / `approval`. A `low` / `auto` proposal and a `high` / `block` one are now genuinely different objects, and §5.4 explains which reasons produce which.

**New refusal codes from the planning endpoint** that the desk should expect: `gateway_unavailable` (503), `planning_timeout` (504), `scheduler_timeout` (504), `planning_in_progress` (409), `stale_planning_context` (409), `event_not_plannable` (409), `proposal_exists` (409), `unsupported_event_type` (422), `invalid_event_context` (422). The first three are retryable: the same request will work once the dependency recovers, so a retry button is worth offering on exactly those.

**Render the code, show the detail.** Every refusal returns both. Do not re-derive any of it in the browser; the model and the desk never compute a metric or a verdict.

**One shared file to glance at.** `src/shared/config/reason-codes.ts` gained `COMMIT_REJECTIONS`. It is additive so nothing of yours breaks, but you are the consuming stream, so the strings are yours to be happy with.

**The safety story is demonstrable in five requests**, which makes a compact demo beat:

```text
commit                  -> 403 approval_required
{"force": true}         -> 400 invalid_commit
approve                 -> 200
commit                  -> 201, snapshot v2
commit again            -> 409 already_committed
```

---

## 7. Verified, and known gaps

### 7.1 Verified on the deployed box

The full loop was run against `https://54.179.142.4.sslip.io` on 15 Sep:

| Step | Result |
|---|---|
| Create event, read it back from another route | HTTP 200 |
| Plan | 2 validated candidates, engine `insertion` |
| Commit before approval | 403 `approval_required` |
| Body with `approved` / `force` / `skipApproval` | 400 `invalid_commit` |
| Approve with no `planId` | 200 |
| Commit | `ok`, snapshot v2, `applied=1` |
| Commit the same proposal again | 409 `already_committed` |
| Board | v2, `job_raffles` assigned to Jonah |
| Audit | `urgent_job` -> `desk_decision` -> `commit`, in order |
| Reset three times after a real commit | v1, unassigned, identical each time |

That satisfies the G2 exit line on the deployed surface. Test counts at the time: 63 unit, 9 G-suite, typecheck clean, verified under both `TZ=UTC` and `TZ=Asia/Singapore`.

Re-verified locally on 20 Sep against `main` at `7089fe5` plus `4bf023b`:

| Check | Result |
|---|---|
| Full suite | 215 passing, 7 skipped, 3 files gated behind live-gateway flags |
| `tsc --noEmit` | Clean |
| `npm run build` | Clean, 13 routes |
| `RUN_SCHEDULER_ACCEPTANCE=1` legality gate | 4 of 4 passing, was 0 of 4 |
| v1.1 blocker probe, replayed | Refused, `MISSING_CERT` and `CERT_EXPIRED` |
| Sustained gateway outage, then recovery | 503, event restored, retry plans normally |
| Deployed box `/health` | `ok`, gateway configured, TLS valid |

Re-verified on 20 Sep after the scheduler change, against `main` at `b8bae2d`:

| Check | Result |
|---|---|
| Full suite | 219 passing, 7 skipped |
| `tsc --noEmit`, `npm run build` | Clean |
| Legality gate | 4 of 4 |
| Two candidates on the Eastwind board | Siti and Jonah, both validating clean |
| Deployed box, audit numbering | `1..7` agent, `8` decision, `9` commit |

The box was redeployed to `b23e7a6` on 20 Sep and the whole loop re-run against
it, now agent-driven rather than calling the scheduler directly:

| Step | Result |
|---|---|
| Reset to Eastwind Tuesday | v1, `snap_eastwind_v1` |
| Create urgent event | 201, `VALIDATED` |
| Plan | 201 in 14 s, native protocol, 5 model calls, 2 validated candidates |
| Risk | `medium` / `approval`, classified from plan evidence |
| Commit before approval | 403 `approval_required` |
| Commit naming the wrong baseline | 400 `snapshot_mismatch` |
| Bare privileged body `{"force":true}` | 400 `invalid_commit` |
| Full body plus `force` and `skipApproval` | Extra fields stripped by the schema, still 403 `approval_required` |
| Approve with no `planId` | 200, `approvedPlanId` resolved from the recommendation |
| Commit | 200, snapshot v2, `applied=1` of 12 slots offered |
| Commit again | 409 `already_committed` |
| Board | v2, `job_raffles` to Jonah 13:00 to 14:30, no job on two technicians |
| Audit | 7 agent steps, then the decision, then the commit |

> **Note:** the privileged-field result is a better demo beat than the documented
> one. A judge who adds `"force": true` to an otherwise valid commit gets the
> field silently discarded at the contract boundary and the commit refused on its
> merits, rather than a validation error. Nothing privileged reaches the guard,
> because the guard is never given the chance to read it.

### 7.2 Known gaps

These are recorded rather than hidden. None blocks the demo on the in-memory adapter.

- **`PostgresDatabase` is not type-checked against `IDatabase`.** A cast in `src/db/index.ts` hides roughly 15 type errors. Two silent bugs were found by accident that this would have caught by design: the Postgres `decision_log` and `approval` queries each wrote columns they never read back, so `listByEvent` could never have matched a row and every medium-risk commit would have been refused forever.
- **`commitPlan` is not wrapped in a transaction.** Unreachable in memory, real on SQL.
- **The box needs one more deploy** to pick up the audit sequence fix below. Nothing else is outstanding on it.
- **Postgres has a schema but no seed.** `seed/` holds only a `.gitkeep` and `PostgresDatabase.seed()` is empty, so flipping `USE_MEMORY_DB=false` yields a blank board.
- **Port 8080 is still open on the box** as a fallback if Caddy misbehaves. Close that firewall rule once you are confident in TLS.
- **The shared docs still describe strict JSON as the tool protocol.** Member 3's
  G0 smoke on 15 Sep found the opposite: strict JSON fails with
  `MALFORMED_TOOL_JSON` and native tools pass, so native is now the source
  default. `AGENTS.md` made that switch conditional on exactly this evidence, so
  the change is authorised, but `tech-stack.md`, `implementation-plan.md` and
  `AGENTS.md` still say otherwise and need a joint edit.
- **`main` accepts direct pushes.** Two of the last four merges to `main` went in without a pull request, so without review or a CI gate. It happened to be fine both times. One command fixes it, and it needs the team's agreement because it changes how everyone pushes:

  ```bash
  gh api -X PUT repos/:owner/:repo/branches/main/protection --input protection.json
  ```

- **The legality gate writes an untracked evidence file** into `docs/team/member-3/` on every run, which has twice been swept into an unrelated commit by `git add -A`. Add the pattern to `.gitignore` or delete the file after running.
- **The rollback drill passed with one gap**, and the gap is imposed by the account rather than by us. See section 7.3.

### 7.3 Rollback drill, and what it revealed about the account

Run on 20 Sep against a snapshot taken after the `b8bae2d` deploy.

**What the restored instance did on its own**, with no commands typed after boot:

```text
aive-app         Up 7 seconds (health: starting)
aive-caddy       Up 7 seconds
aive-optimizer   Up 7 seconds (health: starting)
aive-postgres    Up 7 seconds (healthy)
systemctl is-enabled docker -> enabled
.env  608 bytes
```

That answers the question the drill exists for. A restored box comes back by
itself: Docker starts at boot, `restart: unless-stopped` brings all four
containers up, the Postgres volume is intact, and the gateway credentials come
back with it. A restore that booted without `.env` would be a restore in name
only.

**Not proven, and recorded rather than rounded up:** no HTTP 200 was observed
from the restored box, because the instance was shut down mid-command, and the
static IP was never moved, so the certificate hostname binding is reasoned about
rather than demonstrated. The reasoning is that Caddy's certificate lives in the
`caddy_data` named volume, which is on the instance disk and therefore inside
the snapshot, and the `caddy` container came up.

**The account reaps any second Lightsail instance.** Four attempts were
destroyed within minutes of booting. The fourth was caught in the act:

```text
Broadcast message from root@ip-172-26-12-219 (Sat 2026-09-19 18:32:45 UTC):
The system will power off now!
```

Two details make this worth knowing rather than just annoying:

- That instance was named `Ubuntu-1`, the Lightsail default, not one of the
  `dispatch-restore-test-*` names. The cleanup is **not name-based**, so no
  naming convention avoids it.
- The console is a federated session on an organiser sandbox
  (`ISSISB_IsbUsersPS/<team code>`), not a personal account. CloudShell is
  denied by the permission set, so the Lightsail API cannot be queried directly
  and CloudTrail is likely unavailable too.

The working theory is a one-instance allowance with a scheduled janitor. If that
is right the production box is the incumbent and is not at risk, which matches
five days of uninterrupted uptime. **Worth confirming with the organisers**, and
worth confirming in the form of "is the instance serving our submission
exempt", because the whole demo is one box.

> **Note:** nothing was orphaned and nothing is billing. The reaper deletes what
> it shuts down; Lightsail simply keeps the names reserved afterwards, which is
> why a used name cannot be reused even though the instance is gone.

> **Warning:** this makes the backup recording of the urgent-job spine more
> important, not less. When the lease ends the instance, the URL and the
> certificate all go together, and this account has now demonstrated it will
> delete compute on its own schedule.

---

## Revision history

- **v1.5** 20 Sep 2026 - Ran the G4 rollback drill. A restored instance brings
  the whole stack back unattended. Recorded the one unproven step and the reason
  it cannot be proven here: the sandbox account destroys any second Lightsail
  instance within minutes, irrespective of its name.
- **v1.4** 20 Sep 2026 - Fixed the identical-candidates blocker in member 2's
  insertion engine: travel measured to the job's cluster rather than always the
  CBD, metrics computed rather than hardcoded zeros, and each profile leading
  with its own objective because the shared weights make a weighted sum
  identical across profiles for a pure insertion. Extended G-02, which counted
  plans without ever checking they differed.
- **v1.3** 20 Sep 2026 - Deployed `b23e7a6` and re-ran the whole loop against the
  box, now agent-driven. Rewrote the deploy procedure after
  `docker compose up -d --build` rebuilt both images and silently left both
  containers on the previous ones. Recorded that the two candidate plans are
  identical on the real board, and that stream 1's audit entries were unnumbered
  while member 3's were not.
- **v1.2** 20 Sep 2026 - The release blocker in v1.1 is closed by member 2's
  `1023f25`, verified independently. Rewrote §5 to record the closure and the
  three faults found while confirming it: the violation vocabulary had drifted
  into three spellings, a gateway outage consumed the event permanently, and the
  validator falls back to demo certificates. First two fixed with tests, third
  made visible to the type checker. Refreshed the per-stream asks for member 2's
  scheduler fixes, member 3's risk classifier, and member 4's desk.
- **v1.1** 16 Sep 2026 - Added §5, the open release blocker: an illegal plan
  reaches the board because the validator implements three of eleven violation
  codes. Renumbered the two sections that followed. Recorded the native tool
  protocol switch and the shared-doc drift it leaves behind.
- **v1.0** 15 Sep 2026 - First consolidated handover. Covers Days 1 to 7: containerisation, first Lightsail deploy, the G2 commit path, Caddy and TLS, and the five seam faults found by running the joined-up loop.
