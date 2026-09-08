# ADR 001 — Keep Next.js; solver is a sidecar

**Status:** Accepted
**Date:** 9 Sep 2026
**Owners:** members 1 and 2

## Context

The v1.0 implementation draft described FastAPI, a Vite SPA, SQLite, and in-process OR-Tools. `origin/main` already has Next.js 15, LangGraph in JavaScript, Zod, a Postgres interface, and `db/schema/schema.sql`. Official OR-Tools bindings are Python, not JavaScript.

The product must replan a whole board on technician-unavailable and job-overrun, not only rank one new job. Weighted insertion is the wrong engine for those events. It is the right engine for the Day 5 urgent-job slice and for solver timeout fallback.

## Decision

1. The product application stays Next.js. Do not start a second frontend or move HTTP to FastAPI.
2. Postgres in Compose is the product database. The memory adapter is for tests.
3. `propose(event, schedule, profile)` is the only scheduler API the agent and desk may call.
4. G1 implements `propose()` with Stage A + weighted insertion + independent validator.
5. G3 implements `propose()` with a Python OR-Tools container in `services/optimizer`. Insertion remains the 10 s fallback.
6. Host on one Lightsail instance. No App Runner, Cognito, or managed RDS for the hackathon window.

## Consequences

- Compose grows a second service. Member 1 owns the container plumbing; member 2 owns the model.
- Member 2 can unblock G1 in TypeScript if the sidecar is late.
- Gateway calls are HTTPS with the organiser key. AWS SDKs are not dependencies of the app.
- The v0.4 README (WhatsApp intake as the spine, Bedrock as the LLM) is not the build contract.
