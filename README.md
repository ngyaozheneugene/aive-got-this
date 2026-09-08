# Dispatch Coordinator

**Team:** AI've Got This
**Event:** Show Me Your Agents, NUS-ISS
**Status:** v1.1 execution contract. Scaffold is on `main`; application behaviour is still to land.

An agent-assisted control tower for a Singapore HVAC SME. The day is already booked. When an urgent job arrives, a technician becomes unavailable, or a repair overruns, the system produces at least two validated recoveries, shows the trade-off, and will not commit a consequential change without the desk.

> **Principle.** The model chooses the next step and explains from stored evidence. Code decides who is eligible, what the schedule is, and what may be written.

The working plan is [`docs/implementation-plan.md`](docs/implementation-plan.md) (Word export: `docs/Dispatch_Coordinator_Implementation_Plan.docx`, via `npm run docx`). Ownership is [`docs/team/README.md`](docs/team/README.md). The v0.4 WhatsApp / App Runner / Cognito proposal is historical (`docs/Dispatch_Coordinator_Agent_Proposal.docx`).

---

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 15 App Router |
| Agent | LangGraph (JavaScript) + Zod, strict JSON tools against the organiser LLM gateway |
| Database | Postgres 16 in Docker Compose; in-memory adapter for unit tests |
| Eligibility and travel | Pure TypeScript in `src/matching` and `src/location` |
| Whole-board solver | Python OR-Tools sidecar in `services/optimizer` |
| Host | One Lightsail instance, Singapore, Docker Compose |

Do not add FastAPI as the product API, a second Vite SPA, Cognito, App Runner, or managed RDS.

`propose(event, schedule, profile)` is the scheduler contract. G1 implements it with weighted insertion so an urgent job can appear on the desk. G3 puts OR-Tools behind the same contract for technician-unavailable and overrun. Insertion stays as the 10-second timeout fallback. An independent validator runs on every candidate.

---

## Local run

```bash
npm ci
npm run db:up          # Postgres 16
cp .env.example .env   # then set the gateway key if you have one
npm run dev            # http://localhost:3000
```

```bash
npm run typecheck
npm run test:unit
npm run test:g         # no model
```

`npm run test:a` and `npm run test:x` need the gateway; they run on a schedule in CI, not on every push.

Demo reset, once the API exists: `POST /api/demo/reset`.

---

## Repository

```text
aive-got-this/
├── src/app/                 Next.js. Desk is (desk)/; API under api/
├── src/shared/              Zod, types, config. Imports nothing
├── src/db/                  postgres/ + memory/ (same interface)
├── src/matching/            Stage A gate, validator; insertion propose()
├── src/location/            postal + travel matrix
├── src/agent/               LangGraph, playbooks, JSON tools
├── src/people|catalog|dispatch
├── services/optimizer/      OR-Tools sidecar
├── db/schema/schema.sql     product schema
├── seed/                    Eastwind Aircon Tuesday
├── evals/                   g-suite, a-suite, x-suite
├── docs/implementation-plan.md
└── docs/team/               member briefs
```

Import rules:

- `src/shared/` imports nothing.
- `src/matching/` has no HTTP, no AWS SDK, no database client.
- `src/agent/` never imports SQL. State changes go through tools that re-validate.
- The browser never writes the board. Only the commit path does, after validation and policy.

---

## Demo (four minutes)

1. Show six technicians and the locked promises on the board.
2. Raise a Raffles Place job that the nearest van cannot legally take.
3. Show two plans (SLA-first vs minimal-disruption) and the reasons.
4. Approve a medium-risk change. New snapshot. Open the trace.
5. Mention the injection and infeasible evals; do not spend the minute on WhatsApp intake.

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

Four streams. Names live on the issue board; folders are already split.

| Member | Stream |
|---|---|
| 1 | Platform and data (Compose, Lightsail, schema, commit/reset APIs) |
| 2 | Scheduler (eligibility, travel, validator, OR-Tools sidecar, G-suite) |
| 3 | Agent (LangGraph, risk policy, A/X suites) |
| 4 | Desk (timeline, compare, approve, trace) |

---

## Revision

- **v1.1** 9 Sep 2026 — Execution contract aligned with the control-tower plan: Lightsail, gateway, Next.js kept, OR-Tools sidecar, insertion for G1.
- **v0.4** 5 Sep 2026 — Scaffold and matching-engine proposal. Superseded.
