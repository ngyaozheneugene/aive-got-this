# Technology stack

**Product:** Dispatch Coordinator
**Source:** Implementation plan v1.1, adapted from the 8 Sep 2026 control-tower draft. FastAPI / Vite / SQLite from that draft apply only where noted.

This is the stack we build and deploy. The v0.4 proposal (App Runner, Bedrock, RDS, Cognito) is not.

---

## Choices

| Layer | Choice | From the pasted plan | Change from v0.4 |
|---|---|---|---|
| Host | One Ubuntu 24.04 Lightsail, 4 GB / 2 vCPU / 80 GB, Singapore (`ap-southeast-1`) | Yes | Was App Runner + t3.small fallback |
| Reverse proxy | Caddy (TLS, routing, request limits) on the box | Yes (Nginx or Caddy) | Was App Runner TLS |
| Product app | Next.js 15 App Router (desk UI + Route Handlers) | No — draft said Vite + FastAPI | Keep what is already on `main` |
| Agent | LangGraph JS, Zod schemas, **strict JSON tool protocol** against the organiser gateway | Protocol yes; language is JS not Python | Was Bedrock native tools |
| Model | Gateway **Claude Sonnet 4.5**, `X-API-Key`, retries/backoff | Yes | Was Bedrock in our account |
| Optimizer | Python **OR-Tools**, FastAPI sidecar on `:8081` | OR-Tools and FastAPI yes; sidecar not in-process in the product app | New |
| Eligibility / travel / validator | Pure TypeScript, no I/O | Draft said pure Python | Stays in `src/matching` so G-suite has no Python |
| Database | Postgres 16 on a Compose volume | Draft said SQLite | Schema and `IDatabase` already exist |
| Tests | Vitest. G-suite no model. A/X against the gateway | Eval split yes | A/X no longer assume Bedrock |
| Auth | Demo roles | Draft: no Cognito | Was Cognito |

OpenClaw and Hermes stay out of the critical path.

---

## Runtime on the box

```text
Caddy :443
  └── Next.js :8080
        ├── LangGraph  →  LLM gateway (Claude Sonnet 4.5, JSON tools)
        ├── Postgres :5432
        └── optimizer :8081  (FastAPI + OR-Tools)
```

`propose()` is the only scheduler API the app calls. The sidecar serves all three events; insertion (TypeScript) is the 10 s timeout fallback. Whichever engine answers, `measurePlan()` in `src/matching/measure.ts` computes the plan's metrics, so the desk compares like with like. See ADR 004.

---

## Node dependencies (product app)

Keep: `next`, `react`, `postgres`, `zod`, `@langchain/core`, `@langchain/langgraph`, `@langchain/langgraph-checkpoint-postgres`.

Removed from the app: `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/client-s3`, `@aws-sdk/client-ssm`, `rrule`. Recurrence is P2; the SQL column can sit unused.

Gateway calls are HTTPS with the organiser key. No AWS SDK in the app.

---

## Optimizer sidecar

`services/optimizer/` — FastAPI + Uvicorn + OR-Tools, as in the pasted draft, isolated so the product app stays TypeScript.

| Path | Role |
|---|---|
| `GET /health` | Compose and Lightsail health |
| `POST /propose` | `{ event, schedule, profile }` → candidate plans |

Timeout 10 s. The TypeScript validator still runs on every candidate, and TypeScript re-measures every candidate's metrics.

Objectives, per profile (`services/optimizer/app.py`):

| Profile | Minimises |
|---|---|
| `sla_first` ("On-time first") | Lateness past window open × priority, drive minutes, and the workload gap (1 point ≈ 1.2 drive minutes) |
| `minimal_disruption` ("Least disruption") | Moved jobs, colleagues disturbed, the receiver's load pressure, drift, waiting time for new jobs, and the workload gap |

Urgent jobs may also reassign booked work around them: see ADR 004.

---

## Environment

See `.env.example`.

| Variable | Where |
|---|---|
| `LLM_GATEWAY_URL` | Server only |
| `LLM_GATEWAY_API_KEY` | Server only |
| `LLM_GATEWAY_MODEL` | Default `claude-sonnet-4-5` |
| `DATABASE_URL` | Postgres |
| `OPTIMIZER_URL` | Default `http://localhost:8081` |

Never expose the gateway key to the browser.

---

## Budget

The starter kit’s US$24/month Lightsail plan plus gateway usage on the organiser key. No second instance, no hosted model, no managed RDS, no paid routing API.

---

## Out

App Runner, Cognito, RDS as a service, Bedrock as *our* billed model, a second Vite SPA, SQLite as the product store, OpenClaw/Hermes on the scheduling path, live traffic APIs.
