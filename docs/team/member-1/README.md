# Member 1: platform and data

**Person:** Eugene
**Stream:** Lightsail, Compose, schema, seed, Dispatch writes
**Folders:** `infra/`, `db/`, `seed/`, `src/db/`, `src/platform/`, `src/people/`, `src/catalog/`, `src/dispatch/`, `src/app/api/`, `.github/`
**Plan role:** D
**Secondary reviewer:** member 4

**Current state:** [`handover.md`](handover.md) is the consolidated status for the
whole team - what is deployed, the contracts other streams call, the faults found
so far, and what each stream needs to do. Start there.

You own the box and the write path. Other people cannot commit a schedule, reset the demo, or deploy without you. You do not own eligibility, OR-Tools, or the desk UI. Event and commit path: [`docs/workflow.md`](../../workflow.md). Stale, reset, and fail-closed commit: [`docs/usecases.md`](../../usecases.md) UC-07, UC-10, UC-12.

---

## 1. Mission

Give members 2–4 a frozen, seeded, typed data layer by the end of day two, then keep snapshots, approvals, and demo reset honest for three weeks.

---

## 2. What you own

| Folder | Contents |
|---|---|
| `db/schema/` | Product schema. Additive changes for proposals/events go through an ADR. |
| `db/migrations/` | After the freeze. |
| `seed/` | Pointer only. Canonical Tuesday is `src/shared/fixtures/eastwind.ts` until SQL apply lands. |
| `src/db/postgres/` | Product client. |
| `src/db/memory/` | Same interface. Highest-value day-two ship. |
| `src/people/`, `src/catalog/`, `src/dispatch/` | Domain modules. Recurrence stays unused (P2). |
| `src/app/api/` | `schedule/current`, events, proposals, decision, commit, audit, demo reset, health. Validate with member 3 Zod. |
| `docker-compose.yml`, `Dockerfile` | Postgres + optimizer sidecar (image owned with member 2) + Next.js. |
| `.github/workflows/` | G per commit. A/X on schedule against the gateway. |
| Lightsail | One instance. Backup, rollback, `/health`. |

`infra/apprunner`, `infra/cognito`, `infra/rds`: leave empty. Demo logins, not Cognito. Postgres in Compose, not RDS.

`src/platform/aws/` is unused. The agent uses the organiser gateway, not Bedrock.

---

## 3. Contracts

**You publish**

- Read models: current board, proposal, approval card.
- Domain events: urgent job, technician unavailable, job overrun.
- `IDatabase`, implemented twice.
- Commit rules: source `board_snapshot` id must match; approval required when policy says so; validator must have passed.

**You consume**

- `propose()` from member 2 (HTTP to the sidecar or in-process insertion).
- Tool Zod schemas from member 3.
- Risk decision from member 3's policy module (data, not a prompt).

---

## 4. Weeks

**Week 1.** Day 2: schema deltas agreed, memory adapter, seed reset, Compose Postgres. Days 3–5: event + proposal + commit stubs, first Lightsail deploy with `/health`. G1 needs a proposal the desk can see; it does not need Cognito.

**Week 2.** Transactions, stale snapshot reject, demo reset that is actually idempotent. Support member 2 wiring the sidecar.

**Week 3.** Snapshot backup, rollback drill, five demo resets in a row.

---

## 5. Rules

- Only Dispatch writes `status_event` (append-only).
- Only the commit path writes a new `board_snapshot`.
- `decision_log` is append-only; the agent writes it through a tool you host.
- Untrusted text in `*_raw` columns.
- No secrets in git. Environment files on the box.
- Do not reimplement ranking in SQL.

---

## 6. Commit API for consumers

Live since 14 Sep. Member 4 calls these from the desk; member 3 calls the same
logic through tools. Zod bodies are frozen in `src/shared/contracts/tools.ts`.
Extra fields are stripped — the server never reads a flag the caller invents.

### `POST /api/proposals/{id}/decision`

```json
{ "decision": "approved" | "rejected", "planId": "plan_x", "reason": "...", "actorId": "user_desk" }
```

`planId` is optional and falls back to the proposal's `recommendedPlanId`, so
approving the recommendation needs only `decision`, `reason`, `actorId`.
Returns `{ approval, proposal }`. Each decision writes its own `approval` row;
the newest is the live verdict.

### `POST /api/proposals/{id}/commit`

```json
{ "planId": "plan_x", "sourceSnapshotId": "snap_eastwind_v1", "actorId": "user_desk" }
```

`sourceSnapshotId` is the snapshot the desk planned against — send back what
`GET /api/schedule/current` gave you. Success returns
`{ ok: true, snapshot: { id, version }, proposal, applied }`.

### Refusals

Every failure is `{ "error": "<code>", "detail": "<sentence>" }`. Codes are in
`src/shared/config/reason-codes.ts` as `COMMIT_REJECTIONS`. Render the code;
the detail is a human sentence, safe to show.

| Code | HTTP | Means |
|---|---|---|
| `proposal_not_found` / `plan_not_found` | 404 | No such row |
| `plan_not_in_proposal` | 400 | That plan belongs to another proposal |
| `already_committed` | 409 | This proposal already produced a snapshot |
| `proposal_rejected` | 409 | The desk rejected it. Needs a new proposal, not a retry |
| `validation_failed` | 409 | The validator refused the plan; `detail` names the violations |
| `snapshot_mismatch` | 400 | Caller named a baseline this proposal never used. Client bug |
| `stale_snapshot` | 409 | The board moved on. Re-plan, then retry |
| `approval_required` | 403 | Medium risk with no approved row covering *this* plan |
| `commit_blocked` | 403 | High risk. No commit path exists |

`stale_snapshot` is the only one worth an automatic retry, and only after
re-planning. The rest need a human or a code fix.

### `GET /api/events/{id}/audit`

Returns `{ eventId, status, entries }`, ordered by `sequence` then
`created_at`. Backs the trace drawer.

### Invariants consumers can rely on

- A refused commit changes nothing. The board version is identical afterwards.
- Only the commit path writes a `board_snapshot`. Nothing else in the codebase
  calls `createSnapshot`.
- Authorisation is read from the stored `approval` row, never from the request.
- `plan.assignments` is applied as *the slots the plan asserts*. Jobs a plan
  does not mention keep their technician. **Member 2: confirm `propose()`
  returns changed slots rather than the whole day, or commits will rewrite
  every row and the audit trail will overstate what moved.**

### Known gaps before the Postgres switch

- `PostgresDatabase` is not type-checked against `IDatabase` (a cast hides it).
- `commitPlan` is not wrapped in a transaction. Harmless in memory, not on SQL.
