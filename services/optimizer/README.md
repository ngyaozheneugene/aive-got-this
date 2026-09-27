# Optimizer sidecar

Python OR-Tools CP-SAT sidecar. FastAPI, isolated from Next.js. `GET /health` and `POST /propose`.

Member 2 owns the model. Member 1 owns Compose and Lightsail wiring.

## Contract

- `GET /health`
- `POST /propose` body: `{ event, schedule, profile }` where `profile` is `sla_first` or `minimal_disruption`
- Response: candidate plans with assignments, metrics, solver duration, timeout flag
- The TypeScript validator in `src/matching` still runs on every candidate. This service does not commit.

- The request also carries `eligibility: {jobId: [technicianId, ...]}` from Stage A. The solver never re-derives legality.
- Metrics in the response are informational: the app re-measures every plan with `measurePlan()`.

## What it decides

| Event | Jobs in play |
|---|---|
| `technician_unavailable` | Their jobs that have not started, reassigned |
| `job_overrun` | The job's end moves; that technician's later jobs may be retimed or reassigned |
| `urgent_job` | The new job, plus **rolling rebalance**: any booked job that has not started, is not promised or locked, and starts at least 60 min after the board's "now" may change technician (never time) when that pays |

The board's "now" is the latest start of work already under way (else the earliest clock-in). Both profiles also minimise the **workload gap**: busiest minus idlest working technician, in % of their day. Constants (`FROZEN_HORIZON_MINUTES`, `REBALANCE_MOVE_COST`, `BALANCE_WEIGHT`) are at the top of `app.py`. See ADR 004.

Insertion `propose()` in TypeScript remains the 10 s fallback in the app.

## Local

```bash
npm run db:up                                   # Postgres + this service on :8081
RUN_SIDECAR_ACCEPTANCE=1 OPTIMIZER_URL=http://localhost:8081 \
  npx vitest run evals/g-suite/g08-sidecar-legality.acceptance.test.ts
```

G-08 refuses the insertion fallback: `engine` must be `ortools`. It covers sick-technician and overrun legality, the Raffles comparison, workload balance after a sick call, and an urgent job that rebalances to free the only qualified technician.
