# Agent playbook — Dispatch Coordinator

**Team:** AI've Got This  
**Product:** Dispatch Coordinator (generic name; not DispatchIQ)  
**Demo:** Eastwind Aircon, 30 minutes, same P0 loop — not extra features

This file is the session entrypoint. Cursor rules in `.cursor/rules/` repeat the hard constraints when you are in a stream’s files.

## Every session

Before starting new work, read `docs/tasks.md` and the active integration
handoffs linked from it. Check the requests assigned to your stream
against the current code. Reproduce reported failures before declaring
them resolved, and record the tested revision and evidence.

1. Read [`docs/tasks.md`](docs/tasks.md). Obey **Current gate**. Do not start the next gate’s work except as listed there.
2. Identify the stream from the files you will touch. Read that brief in [`docs/team/`](docs/team/README.md).
3. If you change the recovery loop, also read [`docs/workflow.md`](docs/workflow.md) and the matching story in [`docs/usecases.md`](docs/usecases.md).
4. Plan and architecture stay in [`docs/implementation-plan.md`](docs/implementation-plan.md). Stack stays in [`docs/tech-stack.md`](docs/tech-stack.md).
5. When you finish a listed item, mark it `[x]` in `docs/tasks.md` in the same change. Do not keep a second task list in chat.

## Streams

| Touch | Stream | Brief |
|---|---|---|
| `db/`, `seed/`, `src/db/`, `src/app/api/`, Compose, CI, Lightsail | 1 Platform (Eugene) | [`docs/team/member-1/README.md`](docs/team/member-1/README.md) |
| `src/matching/`, `src/location/`, `services/optimizer/`, `evals/g-suite/` | 2 Scheduler (Damon) | [`docs/team/member-2/README.md`](docs/team/member-2/README.md) |
| `src/agent/`, `evals/a-suite/`, `evals/x-suite/` | 3 Agent (Deen) | [`docs/team/member-3/README.md`](docs/team/member-3/README.md) |
| `src/app/` except `src/app/api/` | 4 Desk (Khant) | [`docs/team/member-4/README.md`](docs/team/member-4/README.md) |
| `src/shared/`, `docs/adr/` | all | Breaking change needs a consuming-stream reviewer |

Stay in your stream’s folders. Do not “helpfully” rewrite another stream.

## Hard constraints

- Model chooses the next **named tool**. Code owns eligibility, scores, validation, risk, and writes.
- `src/shared/contracts/` may import `zod`. The rest of `src/shared/` imports nothing else. `src/matching/` has no HTTP, no DB client, no AWS SDK. `src/agent/` never imports SQL.
- Browser never writes the board. Only commit, after validator + policy + source snapshot.
- Untrusted text stays in `*_raw` and is quoted to the model. Injection is data.
- Two profiles: `sla_first` and `minimal_disruption`. Metrics are backend-owned.
- Insertion `propose()` is G1 + 10 s fallback. OR-Tools sidecar is the product engine for unavailable / overrun (G3).
- After Day 14: no new features. After Day 18: release-blocking fixes only.

## Do not build

WhatsApp/SMS intake as the spine, OpenClaw, Hermes, live GPS/traffic, Cognito, App Runner, managed RDS, Bedrock as our billed model, a second Vite SPA, SQLite as the product DB, customer portal, RRULE materialisation.

Leave `infra/apprunner`, `infra/cognito`, `infra/rds`, and `src/platform/aws/` empty.

v0.4 proposal doc is historical. Do not implement it.

## Branches and APIs

- Branch: `member-N/<short-topic>` off `main`.
- Desk APIs: `/api/schedule/current`, `/api/events`, `/api/proposals/{id}`, decision, commit, audit, `/api/demo/reset`.
- Do not recreate `src/app/api/intake|coordinator|webhooks`.
- Optimizer `POST /propose` is internal. Browser does not call it.

## Done means

The path works on the intended surface for this gate (memory tests, local Compose, or Lightsail — see the task). A notebook or an explanation in chat is not done.
