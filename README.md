# Dispatch Coordinator

**Team:** AI've Got This
**Event:** Show Me Your Agents, NUS-ISS
**Status:** v1.3 (27 Sep 2026). Submitted. All three disruptions plan, validate, approve and commit end to end on the live system. The OR-Tools sidecar serves every event, with rolling rebalance for urgent jobs and a workload-balance objective ([ADR 004](docs/adr/004-balance-and-rolling-rebalance.md)).

An agent-assisted control tower for a Singapore HVAC SME. The day is already booked. When an urgent job arrives, a technician becomes unavailable, or a repair overruns, the system produces at least two validated recoveries, shows the trade-off, and will not commit a consequential change without the desk.

> **Principle.** The model chooses the next step and explains from stored evidence. Code decides who is eligible, what the schedule is, and what may be written.

## Live system

| | |
|---|---|
| Coordinator desk | https://54.179.142.4.sslip.io/desk |
| Health check | https://54.179.142.4.sslip.io/health |
| Hosting | AWS Lightsail, Singapore (ap-southeast-1); Docker Compose; Caddy with a Let's Encrypt certificate |
| Available until | The AWS lease ends, mid-October 2026 |
| Spend | US$9.11 of the US$100 lease budget, as of 27 Sep 2026 |

**Redeploy after a merge:** one line on the box, see [`docs/deploy.md`](docs/deploy.md).

**Try it.** `/desk` opens *your workspace*: empty on day one, with **Team** to add technicians and **New job** to book work. Click **Try a sample day** (or open `/desk?mode=simulation`) for Eastwind Aircon's full day: 15 technicians and 41 jobs. There, type what happened in plain words ("Kumar's van broke down, he's out till 2pm") and confirm what the assistant read, or mark anyone unavailable or a job running late from the list, book a new job, or use **Demo controls**. Two validated plans come back; pick one, give a reason, and approve, and the schedule becomes a new version. If nobody can legally take a job, the plan covers the rest and leaves that one for a call. **Reset the demo day** works only in the simulation. See [ADR 008](docs/adr/008-workspaces-and-simulation.md).

**Verified on 27 Sep 2026.** The full demonstration sequence was replayed against the live URL: every plan validated clean, every commit was refused before approval and accepted after it, and every audit trail read in order. 275 automated tests pass, the real-solver acceptance gate passes 7 of 7, and the scheduler legality gate passes 4 of 4.

Agents start at [`AGENTS.md`](AGENTS.md) and the board at [`docs/tasks.md`](docs/tasks.md). The working plan is [`docs/implementation-plan.md`](docs/implementation-plan.md). Product loop is [`docs/workflow.md`](docs/workflow.md). Use cases are [`docs/usecases.md`](docs/usecases.md). Stack detail is [`docs/tech-stack.md`](docs/tech-stack.md). Ownership is [`docs/team/README.md`](docs/team/README.md). The v0.4 WhatsApp / App Runner / Cognito proposal is historical (`docs/Dispatch_Coordinator_Agent_Proposal.docx`).

---

## Stack

| Layer | Choice |
|---|---|
| Host | Ubuntu 24.04 Lightsail, 4 GB / 2 vCPU, Singapore |
| Proxy | Caddy (TLS) |
| App | Next.js 16 App Router, React 19, Tailwind 4; OneMap tiles via Leaflet |
| Agent | LangGraph (JavaScript) + Zod |
| Model | Organiser gateway, Claude Sonnet 4.5, native tool calls (strict JSON kept as a diagnostic mode) |
| Database | One interface, two adapters held to the same results by a contract test: Postgres 16 in Compose (migrated and seeded on first use, commits in one transaction) and in-memory for tests and zero-setup runs |
| Eligibility | TypeScript in `src/matching` |
| Solver | FastAPI + OR-Tools sidecar (`services/optimizer`) |

Do not add a second Vite SPA, Cognito, App Runner, Bedrock as our billed model, or managed RDS. FastAPI is the optimizer only.

`propose(event, schedule, profile)` is the scheduler contract. OR-Tools answers it for all three events; weighted insertion (TypeScript) is the 10-second timeout fallback. An independent validator runs on every candidate, and `measurePlan()` computes every candidate's metrics, whichever engine produced it.

### How it answers the brief

| The brief asks for | Where it lives |
|---|---|
| Assign by **skills** and **availability** | Stage A (`src/matching/gates/`): certificates and expiry, tier, shift, parts and tools, locks. The validator re-checks every plan. |
| Assign by **location** | Cached cluster travel matrix; routes are costed in start order, so chained jobs pay one drive. |
| Assign by **urgency** | Priority-weighted lateness in the solver; customer windows are hard constraints. |
| Less **travel** | Drive minutes in both objectives. The metric is the fleet driving a plan adds, and it can be negative. |
| Fewer **delayed appointments** | Lateness metric; windows enforced; overruns replan downstream work. |
| Even **utilisation** | Workload gap (busiest minus idlest technician, % of their day) on every plan. Both profiles minimise it. |
| Requests **arriving through the day** | Each event plans against the latest snapshot. An urgent job can hand booked, unstarted work to a colleague at the same time to free the right technician (UC-16). |

---

## Local run

One command — installs what's missing, creates `.env.local`, starts the optimizer and Postgres if Docker is running, then opens the desk:

```bash
npm run start:local    # or scripts/run.sh; --help for options
```

Or step by step:

```bash
npm ci
cp .env.example .env   # in-memory board by default; gateway key later
npm run dev            # http://localhost:3000/desk
# optional:
npm run db:up          # Postgres 16 + optimizer sidecar
```

**On Postgres.** With `npm run db:up` running, set `USE_MEMORY_DB=false`. On first use the app applies `db/migrations/*.sql` and seeds an empty database with today's board, so commits survive a restart. `POST /api/demo/reset` reseeds it.

```bash
npm run typecheck
npm run test:unit
npm run test:g         # no model
npm run test:pg        # Postgres adapter vs the in-memory one; needs a dispatch_test database
```

Create the test database once: `docker exec aive-postgres psql -U dispatch -c "CREATE DATABASE dispatch_test"`. Every `test:pg` run truncates it.

`npm run test:a` and `npm run test:x` need the gateway; they run on a schedule in CI, not on every push.

Open http://localhost:3000/desk for today's board. `POST /api/demo/reset` restores it. `GET /health` reports the app, a real database read (`databaseOk`, `boardVersion`) and the optimizer.

---

## Repository

```text
aive-got-this/
├── src/app/                 Next.js. Desk is (desk)/; API under api/
├── src/shared/              Zod contracts, types, config, Eastwind fixture
├── src/db/                  postgres/ + memory/ (same interface)
├── src/matching/            Stage A gate, validator, measurePlan(); insertion propose() fallback
├── src/location/            postal + travel matrix
├── src/agent/               LangGraph, playbooks, typed tools, risk policy
├── src/people|catalog|dispatch
├── services/optimizer/      OR-Tools sidecar
├── db/migrations/           product schema, applied in order on startup
├── seed/                    Eastwind Aircon Tuesday
├── evals/                   g-suite, a-suite, x-suite
├── AGENTS.md                session playbook for coding agents
├── docs/tasks.md            living gate board (tick boxes)
├── docs/implementation-plan.md
├── docs/workflow.md
├── docs/usecases.md
└── docs/team/               member briefs
```

Import rules:

- `src/shared/` may import `zod` in `contracts/` only. No HTTP, SQL, or React.
- `src/matching/` has no HTTP, no DB client, no AWS SDK.
- `src/agent/` never imports SQL.
- The browser never writes the board. Only the commit path does, after validation and policy.

---

## Demo (30 minutes)

The first live demo is 30 minutes. One person drives the desk. One person narrates.

1. Problem and who it is for (Eastwind, day already booked).
2. Architecture: `propose()`, validator, approval, Lightsail, native tool calls through the gateway.
3. Tuesday board and its 44-point workload gap. Raffles Place urgent job. Two plans. Approve On-time first. New snapshot.
4. Technician unavailable: the balance trade-off (gap 44 → 12 for 32 more minutes of driving). Reset, then a 90-minute overrun.
5. Injection note, infeasible case, G/A/X, trace drawer, spend vs $100.

Do not open with WhatsApp intake. Do not fill the extra time with OpenClaw. The minute-by-minute rundown is plan §12.1. The backup recording script is [`docs/demo-script.md`](docs/demo-script.md).

---

## Rubric

| Criterion | Where to look |
|---|---|
| 1. Goal and scope | Plan §2, this README, the opening board |
| 2. Architecture and loop | Plan §3, `src/agent/`, interrupt → resume on approve |
| 3. Tool use | Zod tools, `propose()`, validator |
| 4. Autonomy and HITL | AUTO / APPROVAL / BLOCK on the server |
| 5. Safety | Untrusted notes, no direct writes, stale snapshot reject |
| 6. Observability and eval | `decision_log`, G/A/X, plan §8 |
| 7. Platform | Next.js + OR-Tools sidecar + Lightsail + native tool calls through the gateway |

---

## Team

Four streams.

| Member | Name | Stream |
|---|---|---|
| 1 | Ng Yao Zhen Eugene | Platform and data (Compose, Lightsail, schema, commit/reset APIs) |
| 2 | Lim Zhen Eu Damon | Scheduler (eligibility, travel, validator, OR-Tools sidecar, G-suite) |
| 3 | Deen Al Eusuf | Agent (LangGraph, risk policy, A/X suites) |
| 4 | Khant Phone Sett | Desk (timeline, compare, approve, trace) |

---

## Revision

- **v1.3** 27 Sep 2026 — Live system, evidence and spend for submission. Stack table brought up to date: Next.js 16, native tool calls, and the in-memory adapter the live demo runs on.
- **v1.2** 27 Sep 2026 — Sidecar for all three events, rolling rebalance around urgent jobs, workload-balance metric and objective, one `measurePlan()` for every engine (ADR 004).
- **v1.1** 9 Sep 2026 — Execution contract aligned with the control-tower plan: Lightsail, gateway Claude Sonnet 4.5, Next.js kept, FastAPI/OR-Tools sidecar.
- **v0.4** 5 Sep 2026 — Scaffold and matching-engine proposal. Superseded.
