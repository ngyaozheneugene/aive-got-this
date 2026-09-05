# Team split and ownership v1

**Team:** AI've Got This, four people, five days a week, three weeks<br>
**Source of truth:** the root [`README.md`](../../README.md)<br>
**Status:** Ownership is settled. The contracts in §3 are the only thing that must be agreed before parallel work starts.

This document says who owns which folders, what each person publishes to the others, and what has to exist before the four streams can run without blocking each other. Each member has a brief of their own in `docs/team/member-N/`.

---

## 1. The split

The proposal already names six modules and four import rules (root README §11), so the split follows those boundaries rather than inventing new ones. One person owns the data layer, one owns the pure decision code, one owns the agents, and one owns the surfaces.

| # | Stream | Owns | Brief |
|---|---|---|---|
| 1 | Platform and data | `infra/`, `db/`, `seed/`, `src/db/`, `src/people/`, `src/catalog/`, `src/dispatch/`, `.github/` | [member-1](member-1/README.md) |
| 2 | Matching and location | `src/matching/`, `src/location/`, `evals/g-suite/`, `evals/fixtures/` | [member-2](member-2/README.md) |
| 3 | Agent and orchestration | `src/agent/`, `evals/a-suite/`, `evals/x-suite/` | [member-3](member-3/README.md) |
| 4 | Surfaces | `src/web/` | [member-4](member-4/README.md) |
| all | Shared contracts and decisions | `src/shared/`, `docs/adr/` | this file |

> **Why:** `src/dispatch/` sits with member 1 rather than with the agent or the web person because both of those write through it. `status_event` is append-only and Dispatch is its only writer, so the module belongs with whoever owns the schema and its invariants.

---

## 2. Folder map

```text
aive-got-this/
├── .github/workflows/          1  CI: G per commit, A and X on a schedule
├── db/
│   ├── schema/                 1  schema.sql, frozen day two
│   └── migrations/             1  changes after the freeze
├── seed/                       1  16 technicians, certs with one expiry, ~40 jobs
├── infra/
│   ├── apprunner/              1  the PWA service
│   ├── rds/                    1  db.t4g.micro, three DB roles
│   ├── cognito/                1  technician / desk / admin groups
│   ├── scheduler/              1  the 15-minute tick
│   ├── s3/                     1  imports and eval artefacts
│   ├── ssm/                    1  secrets, none in git
│   └── observability/          1  CloudWatch, budget alert at $80
├── src/
│   ├── shared/
│   │   ├── contracts/         all Zod schemas shared by model, server and UI
│   │   ├── types/             all read models and enums
│   │   └── config/            all weights, thresholds, caps
│   ├── db/
│   │   ├── postgres/           1  the real client
│   │   └── memory/             1  in-memory double, so 2/3/4 test without RDS
│   ├── people/                 1  app_user, technician, technician_cert, shift
│   ├── catalog/                1  customer, site, site_memory, job_type, recurrence
│   ├── dispatch/               1  job, job_requirement, assignment, status_event
│   ├── matching/
│   │   ├── gates/              2  Stage A, eligibility
│   │   └── scoring/            2  Stage B, ranking and crew size
│   ├── location/
│   │   ├── postal/             2  postal to region and estate
│   │   └── matrix/             2  travel matrix, insertion cost, peak
│   ├── agent/
│   │   ├── runtime/            3  LangGraph, RDS checkpointer, interrupt and resume
│   │   ├── playbooks/          3  one graph per trigger
│   │   ├── prompts/            3  delimited data blocks, never instructions
│   │   └── tools/
│   │       ├── intake/         3  registry 1, draft jobs only
│   │       ├── coordinator/    3  registry 2, state through validated tools
│   │       └── desk/           3  registry 3, acts as the signed-in user
│   └── web/
│       ├── customer/           4  paste a message, status and ETA
│       ├── technician/         4  clock in, offers, today, escalate
│       ├── desk/               4  board, approval cards, Why?
│       └── shared/             4  components used by all three surfaces
├── evals/
│   ├── g-suite/                2  no model, pure functions
│   ├── a-suite/                3  agent, asserts on tool calls
│   ├── x-suite/                3  adversarial, asserts on tool calls
│   ├── fixtures/               2  committed travel matrix and seed cases
│   └── reports/               all offline metrics, week 1 against week 3
└── docs/
    ├── adr/                   all one file per open question resolved
    └── team/                  these briefs
```

---

## 3. Contracts, and why they come first

Four people cannot work in parallel against folders alone. Everything crosses at `src/shared/`, so that folder is written on day one and frozen on day two alongside the schema.

| Contract | Published by | Consumed by | Shape |
|---|---|---|---|
| Tool schemas | 3 | 3 for the model, 1 for the server | One Zod schema per tool, shared by both sides |
| `EligibleTechnician`, `RankedTechnician` | 2 | 3, 4 | Stage A and Stage B outputs, including every exclusion reason |
| Scoring constants | 2 | 2, and read by 4 for the Why? panel | Weights, sub-weights, over-qualification penalty, crew triggers |
| Read models | 1 | 4 | Board, job, technician day, approval card |
| Domain events | 1 | 3 | `job.created`, `tech.declined`, `tech.no_show`, and the rest |
| In-memory DB double | 1 | 2, 3, 4 | Lets everyone test before RDS exists |

> **Warning:** the in-memory double in `src/db/memory/` is the highest-value thing member 1 ships in the first two days. Without it, members 2, 3 and 4 are blocked on RDS and Cognito, and week 1 loses two days it does not have.

---

## 4. Order of work in week 1

Week 1 carries the whole scheduler, so sequencing matters more than in the later weeks.

1. **Day 1.** Everyone agrees `src/shared/contracts/` and `src/shared/types/`. Member 1 drafts `db/schema/schema.sql`.
2. **Day 2.** Schema frozen. In-memory double lands. Members 2, 3 and 4 unblock and go parallel.
3. **Days 3 to 4.** Stage A and Stage B green on G-01 to G-06. Intake agent green on A-01, A-06, X-01. Desk board renders a ranked top three from fixtures.
4. **Day 5.** Wire the real path end to end: pasted message becomes a job, Wei is hidden, Ahmad is offered, the technician accepts, customer status moves.

---

## 5. Open questions and who resolves them

Root README §17 lists twelve. Each one is assigned here, and each resolution lands as a short file in `docs/adr/`.

| Id | Subject | Owner | Due |
|---|---|---|---|
| O-01 | Snapshot lock against the 10-minute offer window | 1, with 3 | Week 1, day 3 |
| O-02 | Structured site memory instead of free text in the score | 1, with 2 | Week 1, day 2, it changes the schema |
| O-03 | X-07, stored injection through a site note | 3 | Week 2 |
| O-04 | Rate limit and verification on `lookup_site_by_phone` | 1, with 3 | Week 2 |
| O-05 | Terminal state when candidates are exhausted | 1, with 3 | Week 2 |
| O-06 | LEW as a hard gate or a flag | 2 | Week 1, day 2, it changes Stage A |
| O-07 | Publish the qualification sub-weights | 2 | Week 1, day 3, G-01 is meaningless until then |
| O-08 | The week-1 cut list | Whole team | Week 1, day 1 |
| O-09 | Crew-of-two offer protocol | 1, with 3 | Week 3 |
| O-10 | Certificate expiry after assignment | 3, with 1 | Week 3 |
| O-11 | Scheduler for the 15-minute tick | 1 | Week 3 |
| O-12 | Keeping A and X suites cheap and deterministic in CI | 3, with 1 | Week 2 |

Four of these change the schema or Stage A, so they are due in week 1 rather than when the feature ships: O-02, O-06, O-07 and the O-08 cut list.

---

## 6. Rules that hold for everyone

These come from root README §9 and §11. They are not style preferences; the safety story in the rubric depends on them.

- **`src/matching/` never imports HTTP or the AWS SDK.** It is pure functions, and that is what makes the ranking auditable.
- **`src/agent/` never imports SQL.** It reaches the database only through tools that re-validate.
- **`src/catalog/` never calls `src/matching/`.** The catalogue describes work; it does not choose who does it.
- **Customer status is a read of `src/dispatch/`.** Never a second store.
- **Untrusted text lands in a `*_raw` column** and reaches the model only inside a delimited data block.
- **The model never computes a score.** If you find yourself asking a model to rank, stop and put it in `src/matching/scoring/`.

---

## 7. Branch and review

Work on `member-N/<short-topic>` branches off `main`. A change that touches `src/shared/` needs a second pair of eyes from whoever consumes that contract, because it breaks other people's builds; anything inside your own folders does not.
