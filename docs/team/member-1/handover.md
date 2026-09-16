# Stream 1 handover v1.1

**Author:** Eugene (member 1, platform and data)<br>
**Date:** 16 Sep 2026 (Day 8)<br>
**Status:** Current as of `main` at `2560304`, after member 3's agent merge. Section 5 is an open release blocker. Supersedes nothing; read alongside the brief in [`README.md`](README.md) and the board in [`../../tasks.md`](../../tasks.md).

Everything stream 1 has built, deployed, and found, in one place. Read this before working on anything that stores, approves, or commits a schedule, and before pointing a desk or an agent at the API. Section 5 is the open release blocker. Section 6 lists what each of the other three streams needs to know or do.

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

The box tracks `main`. To redeploy after a merge:

```bash
cd ~/aive-got-this && git checkout main && git pull && docker compose up -d --build
```

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

## 5. Open release blocker: an illegal plan can reach the board

An assignment that Stage A excludes on three separate grounds passes the
independent validator, passes the commit guard, and lands on the board as a new
snapshot. Reproduced on `main` at `2560304`:

```text
Stage A on Wei : eligible=false  reasons=["tier_too_low","missing_cert","cert_expired"]
validatePlan() : ok=true  violations=[]
commitPlan()   : ok=true
board          : v2  job_raffles -> Wei
```

Consequently the release criterion "zero known hard-constraint commits" is
currently false, and it is falsifiable in a single request. It is also the first
thing a judge is likely to probe: what stops the system assigning someone
unqualified? As things stand, nothing does, once a candidate plan exists.

### 5.1 This is not a defect in the commit guard

`checkCommit` behaves exactly as the architecture specifies. It refuses to
commit when `plan.validations.ok` is false and it never re-derives feasibility
itself, because `src/matching/` owns eligibility and validation. The guard is
honouring a contract that is not being met at the other end.

Adding eligibility checks to the commit path would break that ownership split
and leave two implementations of the same rules to keep in step. The fix belongs
upstream.

### 5.2 The size of the gap

`src/shared/config/reason-codes.ts` freezes eleven violation codes.
`src/matching/validate.ts` emits three of them:

| Implemented | Missing |
|---|---|
| Duplicate job assignment | `MISSING_CERT` |
| Technician time overlap | `CERT_EXPIRED` |
| In-progress job moved | `OUTSIDE_SHIFT` |
| | `WINDOW_INFEASIBLE` |
| | `TRAVEL_INFEASIBLE` |
| | `LOCKED_MOVED` |
| | `MISSING_PARTS` |
| | `EXCESSIVE_OVERTIME` |

> **Warning:** the three that are implemented emit ad-hoc strings rather than the
> frozen codes: `DUPLICATE_JOB_ASSIGNMENT` where the contract says
> `DUPLICATE_ASSIGNMENT`, and `IN_PROGRESS_JOB_MOVED` where it says
> `IN_PROGRESS_MOVED`. Member 4 renders these, so this is a contract break as
> well as a coverage gap.

### 5.3 How to reproduce it

Member 3's legality gate covers this and three related failures against the real
scheduler and validator, with no gateway quota consumed:

```sh
RUN_SCHEDULER_ACCEPTANCE=1 npx vitest run evals/a-suite/real-scheduler.acceptance.test.ts
```

All four checks fail on current `main`, verified independently by stream 1 in
`TZ=UTC`. The four are the customer window, the independent certificate check,
required carried parts, and a missing shift record.

> **Why this survived every test suite:** each stream's tests pass. The scheduler
> was tested with hand-built schedules, the commit path with hand-built plans,
> and the agent against doubles. Legality only fails when the real components are
> joined, which is the same pattern that produced the five faults in §4.

---

## 6. What each stream needs to know

> **Note:** an `@handle` in a repository file renders as a link but sends no notification. Share this section directly if you need someone to act on it.

### 6.1 Member 2, scheduler (@Requlish)

**Release blocker, and it is yours.** §5 records that an assignment Stage A
excludes for three reasons still passes `validatePlan()` and commits. The
validator implements three of the eleven frozen violation codes. Run the gate in
§5.3; all four checks fail. Nothing downstream can compensate, because the
commit guard is designed to defer to your verdict rather than second-guess it.

**Also open, and it blocks G1.** Both profiles currently pick the same technician, so the two candidate plans are identical. The G1 exit line calls for "two meaningfully different valid candidates", and the 30-minute rundown has a beat comparing SLA-first against minimal-disruption. As things stand, the desk would show the same plan twice. Two likely causes in `src/matching/propose.ts`:

- Travel is computed to a hardcoded `'cbd'` destination rather than the job's actual cluster, so travel is constant across technicians and stops discriminating between them.
- Start times use a placeholder estimate, `9 + assignmentCount * 2` hours, rather than real insertion into gaps.

**Contract change worth making.** `propose()` reaches for `certs`, `shifts`, and `jobRequirements` with a cast and silently falls back to the Eastwind fixture when they are absent, which would plan against fixture certificates instead of real ones. `buildBoardSchedule` now supplies all three, so the fallback is unreachable, but folding them into the published `BoardSchedule` contract would remove the casts entirely.

**For information.** `propose()` returns the whole day, so a one-job insertion carries twelve unchanged slots. The commit path skips no-op slots, so this is harmless for the board and the audit trail. It does mean a trace drawer rendering `plan.assignments` will show twelve rows for a one-job change; rendering `changeSet` avoids that.

**On ownership.** `src/app/api/events/[id]/plan/route.ts` is stream 1's folder. Unblocking yourself there was reasonable, but it meant nobody with the write path's context reviewed it, and three of the five faults in §4 were in that file. Ping stream 1 next time and it will be quicker.

### 6.2 Member 3, agent (@Deen11)

**`risk` and `autonomyMode` are hardcoded** to `medium` and `approval` in the plan route, as the strictest sensible default until your classifier lands. `checkCommit` reads both and takes the stricter of `RISK_POLICY[risk]` and the stored `autonomyMode`, defaulting to `block` on anything unrecognised. A disagreement between them can only ever make committing harder, never easier.

**The commit logic is callable directly.** `commitPlan(db, input)` and `recordDecision(db, input)` in `src/dispatch/` take a database and a plain object. Wrap those as tools rather than calling the HTTP routes from inside the graph.

**`decision_log` is what the trace drawer reads.** Write entries with an `eventId` and a `sequence`; `listByEvent` orders by `sequence` first, then `created_at`.

**Still outstanding from G0:** the gateway smoke test, strict JSON versus native tools. It is the last unticked G0 item. `LLM_GATEWAY_URL` and `LLM_MODEL` in `.env.example` now carry the organiser's exact values.

### 6.3 Member 4, desk (@KhantPS)

**The API is live and real.** Point the desk at it instead of mocks. The endpoint list is §3.1 and the refusal codes are §3.2.

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

That satisfies the G2 exit line on the deployed surface. Test counts: 63 unit, 9 G-suite, typecheck clean, verified under both `TZ=UTC` and `TZ=Asia/Singapore`.

### 7.2 Known gaps

These are recorded rather than hidden. None blocks the demo on the in-memory adapter.

- **`PostgresDatabase` is not type-checked against `IDatabase`.** A cast in `src/db/index.ts` hides roughly 15 type errors. Two silent bugs were found by accident that this would have caught by design: the Postgres `decision_log` and `approval` queries each wrote columns they never read back, so `listByEvent` could never have matched a row and every medium-risk commit would have been refused forever.
- **`commitPlan` is not wrapped in a transaction.** Unreachable in memory, real on SQL.
- **Postgres has a schema but no seed.** `seed/` holds only a `.gitkeep` and `PostgresDatabase.seed()` is empty, so flipping `USE_MEMORY_DB=false` yields a blank board.
- **Port 8080 is still open on the box** as a fallback if Caddy misbehaves. Close that firewall rule once you are confident in TLS.
- **The shared docs still describe strict JSON as the tool protocol.** Member 3's
  G0 smoke on 15 Sep found the opposite: strict JSON fails with
  `MALFORMED_TOOL_JSON` and native tools pass, so native is now the source
  default. `AGENTS.md` made that switch conditional on exactly this evidence, so
  the change is authorised, but `tech-stack.md`, `implementation-plan.md` and
  `AGENTS.md` still say otherwise and need a joint edit.
- **The G4 rollback drill has not been run.** The procedure is designed: restore a snapshot to a new instance, then move the static IP to it. Moving the IP is the step people forget, and without it the restored box gets a different address, so the certificate hostname no longer matches and the URL stays broken.

---

## Revision history

- **v1.1** 16 Sep 2026 - Added §5, the open release blocker: an illegal plan
  reaches the board because the validator implements three of eleven violation
  codes. Renumbered the two sections that followed. Recorded the native tool
  protocol switch and the shared-doc drift it leaves behind.
- **v1.0** 15 Sep 2026 - First consolidated handover. Covers Days 1 to 7: containerisation, first Lightsail deploy, the G2 commit path, Caddy and TLS, and the five seam faults found by running the joined-up loop.
