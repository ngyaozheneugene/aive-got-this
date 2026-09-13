# Team split and ownership

**Team:** AI've Got This
**Source of truth:** [`docs/implementation-plan.md`](../implementation-plan.md)
**Agent playbook:** [`AGENTS.md`](../../AGENTS.md)
**Task board:** [`docs/tasks.md`](../tasks.md)
**Workflow:** [`docs/workflow.md`](../workflow.md)
**Use cases:** [`docs/usecases.md`](../usecases.md)
**Stack:** [`docs/tech-stack.md`](../tech-stack.md)
**README:** product, stack, and how to run — [`README.md`](../../README.md)

Who owns which folders, what each person publishes, and what must exist before the four streams can run in parallel. Member briefs live in `docs/team/member-N/`.

---

## 1. The split

| # | Name | Stream | Owns | Brief |
|---|---|---|---|---|
| 1 | Eugene | Platform and data | `infra/`, `db/`, `seed/`, `src/db/`, `src/platform/`, `src/people/`, `src/catalog/`, `src/dispatch/`, `src/app/api/`, `.github/`, Compose/Lightsail | [member-1](member-1/README.md) |
| 2 | Damon | Scheduler | `src/matching/`, `src/location/`, `services/optimizer/`, `evals/g-suite/`, `evals/fixtures/` | [member-2](member-2/README.md) |
| 3 | Deen | Agent | `src/agent/`, `evals/a-suite/`, `evals/x-suite/` | [member-3](member-3/README.md) |
| 4 | Khant | Desk | `src/app/` except `src/app/api/` | [member-4](member-4/README.md) |
| all | | Shared contracts | `src/shared/`, `docs/adr/` | this file |

`src/dispatch/` stays with Eugene (member 1): both the agent and the desk write through it. `status_event` is append-only and Dispatch is its only writer.

---

## 2. Folder map

```text
aive-got-this/
├── .github/workflows/          1  G per commit; A and X on a schedule
├── Dockerfile                  1  Next.js image for Lightsail
├── docker-compose.yml          1  Postgres + optimizer sidecar
├── services/optimizer/         2  OR-Tools; member 1 owns Compose wiring
├── db/schema/                  1  schema.sql
├── seed/                       1  Eastwind Aircon Tuesday
├── src/app/
│   ├── (desk)/                 4  timeline, compare, approve, trace
│   ├── (technician)/           4  P1 status page
│   ├── (customer)/             4  not P0
│   └── api/                    1  schedule, events, proposals, commit, reset
├── src/shared/                all
├── src/matching/               2  gate, insertion propose(), validator
├── src/location/               2
├── src/agent/                  3
├── evals/g-suite/              2
├── evals/a-suite/              3
├── evals/x-suite/              3
└── docs/
    ├── implementation-plan.md
    ├── workflow.md
    ├── usecases.md
    ├── adr/
    └── team/
```

`infra/apprunner`, `infra/cognito`, and `infra/rds` are unused. Do not fill them.

---

## 3. Contracts first

| Contract | Published by | Consumed by |
|---|---|---|
| `propose()` input/output + reason codes | 2 | 1, 3, 4 |
| Tool Zod schemas | 3 | 3 and 1 (handlers) |
| Read models (board, proposal, approval card) | 1 | 4 |
| Domain events (`job.urgent`, `tech.unavailable`, `job.overrun`) | 1 | 3 |
| In-memory DB double | 1 | 2, 3, 4 |

Without the memory adapter, members 2–4 wait on Postgres. That is still the highest-value day-two deliverable from member 1. They do not wait on Cognito or RDS.

---

## 4. Week 1 order

1. **Day 1.** Freeze `src/shared/` against the implementation plan. Member 1 confirms schema deltas (snapshots, proposals) as ADRs, not a silent rewrite.
2. **Day 2.** G0: fixtures, memory adapter, gateway smoke, optimizer `/health` container.
3. **Days 3–4.** Seed paints a timeline. Insertion `propose()` returns two valid plans for Raffles Place. Desk renders fixtures.
4. **Day 5.** G1: urgent event through API to a visible proposal.

---

## 5. Rules for everyone

- `src/matching/` never imports HTTP or a database client.
- `src/agent/` never imports SQL.
- `src/shared/` may import `zod` in `contracts/` only.
- Untrusted text lands in a `*_raw` column and reaches the model only inside a delimited data block.
- The model never computes a score and never writes the board.
- Legal skill gates cannot be overridden, including by the desk.
- Breaking `src/shared/` needs a reviewer from a consuming stream.

The first live demo is 30 minutes. Khant drives the desk. Deen narrates. Eugene recovers the box. Damon takes solver questions. Same product as G3; do not add a second surface for the extra time.

Work on `member-N/<short-topic>` branches off `main`.

Coding agents: start at [`AGENTS.md`](../../AGENTS.md). Track work only in [`docs/tasks.md`](../tasks.md). Cursor injects `.cursor/rules/` from the files you have open.
