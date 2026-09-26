# Dispatch Coordinator

**Team:** AI've Got This
**Event:** Show Me Your Agents, NUS-ISS
**Status:** v1.2 (27 Sep 2026). All three disruptions plan, validate, approve and commit end to end. The OR-Tools sidecar serves every event, with rolling rebalance for urgent jobs and a workload-balance objective ([ADR 004](docs/adr/004-balance-and-rolling-rebalance.md)).

An agent-assisted control tower for a Singapore HVAC SME. The day is already booked. When an urgent job arrives, a technician becomes unavailable, or a repair overruns, the system produces at least two validated recoveries, shows the trade-off, and will not commit a consequential change without the desk.

> **Principle.** The model chooses the next step and explains from stored evidence. Code decides who is eligible, what the schedule is, and what may be written.

Agents start at [`AGENTS.md`](AGENTS.md) and the board at [`docs/tasks.md`](docs/tasks.md). The working plan is [`docs/implementation-plan.md`](docs/implementation-plan.md). Product loop is [`docs/workflow.md`](docs/workflow.md). Use cases are [`docs/usecases.md`](docs/usecases.md). Stack detail is [`docs/tech-stack.md`](docs/tech-stack.md). Ownership is [`docs/team/README.md`](docs/team/README.md). The v0.4 WhatsApp / App Runner / Cognito proposal is historical (`docs/Dispatch_Coordinator_Agent_Proposal.docx`).

---

## Stack

| Layer | Choice |
|---|---|
| Host | Ubuntu 24.04 Lightsail, 4 GB / 2 vCPU, Singapore |
| Proxy | Caddy (TLS) |
| App | Next.js 15 App Router |
| Agent | LangGraph (JavaScript) + Zod |
| Model | Organiser gateway, Claude Sonnet 4.5, strict JSON tools |
| Database | Postgres 16 in Compose |
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
cp .env.example .env   # memory Eastwind by default; gateway key later
npm run dev            # http://localhost:3000/desk
# optional:
npm run db:up          # Postgres 16 + optimizer sidecar
```

```bash
npm run typecheck
npm run test:unit
npm run test:g         # no model
```

`npm run test:a` and `npm run test:x` need the gateway; they run on a schedule in CI, not on every push.

Open http://localhost:3000/desk for the Eastwind Tuesday board. `POST /api/demo/reset` restores it. `GET /health` reports app + optimizer.

---

## Repository

```text
aive-got-this/
├── src/app/                 Next.js. Desk is (desk)/; API under api/
├── src/shared/              Zod contracts, types, config, Eastwind fixture
├── src/db/                  postgres/ + memory/ (same interface)
├── src/matching/            Stage A gate, validator, measurePlan(); insertion propose() fallback
├── src/location/            postal + travel matrix
├── src/agent/               LangGraph, playbooks, JSON tools
├── src/people|catalog|dispatch
├── services/optimizer/      OR-Tools sidecar
├── db/schema/schema.sql     product schema
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
2. Architecture: `propose()`, validator, approval, Lightsail, gateway JSON tools.
3. Tuesday board and its 44-point workload gap. Raffles Place urgent job. Two plans. Approve On-time first. New snapshot.
4. Technician unavailable: the balance trade-off (gap 44 → 12 for 32 more minutes of driving). Reset, then a 90-minute overrun.
5. Injection note, infeasible case, G/A/X, trace drawer, spend vs $100.

Do not open with WhatsApp intake. Do not fill the extra time with OpenClaw or a map. The minute-by-minute rundown is plan §12.1. The backup recording script is [`docs/demo-script.md`](docs/demo-script.md).

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
| 7. Platform | Next.js + sidecar + Lightsail + gateway JSON tools |

---

## Team

Four streams.

| Member | Name | Stream |
|---|---|---|
| 1 | Eugene | Platform and data (Compose, Lightsail, schema, commit/reset APIs) |
| 2 | Damon | Scheduler (eligibility, travel, validator, OR-Tools sidecar, G-suite) |
| 3 | Deen | Agent (LangGraph, risk policy, A/X suites) |
| 4 | Khant | Desk (timeline, compare, approve, trace) |

---

## Revision

- **v1.2** 27 Sep 2026 — Sidecar for all three events, rolling rebalance around urgent jobs, workload-balance metric and objective, one `measurePlan()` for every engine (ADR 004).
- **v1.1** 9 Sep 2026 — Execution contract aligned with the control-tower plan: Lightsail, gateway Claude Sonnet 4.5, Next.js kept, FastAPI/OR-Tools sidecar.
- **v0.4** 5 Sep 2026 — Scaffold and matching-engine proposal. Superseded.
