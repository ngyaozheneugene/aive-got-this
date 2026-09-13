# Member 1: platform and data

**Person:** Eugene
**Stream:** Lightsail, Compose, schema, seed, Dispatch writes
**Folders:** `infra/`, `db/`, `seed/`, `src/db/`, `src/platform/`, `src/people/`, `src/catalog/`, `src/dispatch/`, `src/app/api/`, `.github/`
**Plan role:** D
**Secondary reviewer:** member 4

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
