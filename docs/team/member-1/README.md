# Member 1: platform and data

**Stream:** AWS, database, seed, and the Dispatch state machine<br>
**Folders:** `infra/`, `db/`, `seed/`, `src/db/`, `src/platform/`, `src/people/`, `src/catalog/`, `src/dispatch/`, `src/app/api/`, `.github/`<br>
**Status:** Week-1 critical path. Three other people are blocked until day two.

You own everything the other three build on: the schema, the seed, the database access layer, the Dispatch state machine, and the AWS account. Your work is front-loaded, and the single most valuable thing you ship is not the real database but the in-memory double that lets everyone else start before RDS exists.

---

## 1. Mission

Give members 2, 3 and 4 a frozen, seeded, typed data layer by the end of day two, then keep the state machine honest for three weeks.

---

## 2. What you own

| Folder | Contents |
|---|---|
| `db/schema/` | `schema.sql`, the runnable source. Frozen on day two. |
| `db/migrations/` | Anything that changes the schema after the freeze. |
| `seed/` | 16 technicians, certificates including one deliberate expiry, roughly 40 jobs. |
| `src/db/postgres/` | The real client. Three DB roles. |
| `src/db/memory/` | An in-memory double with the same interface. |
| `src/people/` | `app_user`, `technician`, `technician_cert`, `shift`. |
| `src/catalog/` | `customer`, `site`, `site_memory`, `job_type`, `job_type_cert`, `recurrence`. |
| `src/dispatch/` | `job`, `job_requirement`, `assignment`, `status_event`. The status machine. |
| `src/platform/aws/` | Bedrock, S3 and SSM clients. The only place they are constructed. |
| `src/app/api/` | Route handlers for intake, coordinator, desk and webhooks. They validate with the Zod contracts member 3 publishes, never a second copy. |
| `infra/` | App Runner, RDS, Cognito, the tick scheduler, S3, SSM, CloudWatch. |
| `.github/workflows/` | CI. G suite per commit, A and X on a schedule. |
| Root build config | `package.json`, `tsconfig.json`, `vitest.config.ts`, `next.config.ts`, `Dockerfile`, `docker-compose.yml`. |

---

## 3. Contracts

### 3.1 You publish

- **Read models** in `src/shared/types/`: board, job, technician day, approval card. Member 4 renders these and nothing else.
- **Domain events** in `src/shared/contracts/`: `job.created`, `tech.declined`, `tech.no_show`, `tech.mc_before_shift`, `job.escalated`, `customer.cancel`, `job.overrun`, `job.done_early`, `shift.tick`. Member 3 subscribes.
- **The database interface**, implemented twice, in `src/db/postgres/` and `src/db/memory/`. Members 2, 3 and 4 code against the interface.
- **`cert_valid_on(tech, cert, job_date)`**, the helper that decides expiry against the job date rather than today.

### 3.2 You consume

- Nothing. You are upstream of everyone, which is why day two matters.

---

## 4. Week by week

### 4.1 Week 1, unblock everyone

- Day 1: draft `schema.sql`, agree `src/shared/` with the other three, stand up the AWS account and the budget alert at $80.
- Day 2: **freeze the schema.** Ship the in-memory double and the seed. This is the hard deadline.
- Days 3 to 5: App Runner and Cognito with three groups, RDS with three DB roles, CI running the G suite, and the Dispatch write path for offer, accept and status transitions.

**Done when** members 2, 3 and 4 can each run their own tests with no AWS credentials, and the real path works end to end on RDS.

### 4.2 Week 2, disruptions and integrity

- Release and re-offer paths in the state machine, including offer expiry after 10 minutes.
- The `approval` table and the desk queue that member 3 resumes threads from.
- Rate limiting and verification on the customer lookup, per O-04.
- Region travel matrix seeded for member 2.

**Done when** an 08:20 no-show releases four jobs and the resulting offers, expiries and approvals are all visible in `status_event` and `decision_log`.

### 4.3 Week 3, location and cost

- Cluster matrix seeded with peak values.
- The 15-minute tick, per O-11.
- Cost dashboard for the demo: Bedrock spend against the $100 cap.

**Done when** the scripted Tuesday runs on a seeded database from a cold start.

---

## 5. Open questions assigned to you

| Id | Question | Due |
|---|---|---|
| O-02 | Split `site_memory` into structured columns the engine can score, plus a display-only `note_raw` | Week 1, day 2 |
| O-01 | Decide what the `snapshot_id` lock actually protects, given offers live 10 minutes | Week 1, day 3 |
| O-05 | Add the terminal state for exhausted candidates, `no_candidates` or similar | Week 2 |
| O-04 | Rate limit plus one-time code on `lookup_site_by_phone` | Week 2 |
| O-09 | What happens when one of a two-person crew accepts and the other declines | Week 3 |
| O-11 | EventBridge Scheduler or in-container cron for `shift.tick` | Week 3 |

> **Warning:** O-02 and O-01 are schema-shaped. Resolve them before the day-two freeze or they become migrations that break member 2 and member 3 mid-week.

---

## 6. Rules you cannot break

- **Only Dispatch writes `status_event`,** and it is append-only. Same for `decision_log`, which only the agent writes.
- **`job_requirement` freezes the gates at job creation** so a later catalogue edit cannot rewrite history.
- **`src/catalog/` never calls `src/matching/`.**
- **Untrusted text goes in a `*_raw` column.** Never interpolate it into anything.
- **No secrets in git.** SSM Parameter Store, always.
