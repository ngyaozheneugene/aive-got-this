# Optimizer sidecar

Python OR-Tools service. The Next.js app is the product; this container only implements `propose()`.

Member 2 owns the model. Member 1 owns Compose and Lightsail wiring.

## Contract

- `GET /health`
- `POST /propose` body: `{ event, schedule, profile }` where `profile` is `sla_first` or `minimal_disruption`
- Response: candidate plans with assignments, metrics, solver duration, timeout flag
- The TypeScript validator in `src/matching` still runs on every candidate. This service does not commit.

G1 may call insertion `propose()` in TypeScript and ignore this container beyond `/health`.
G3 must serve unavailable and overrun from here. Insertion remains the 10 s fallback in the app.

## Local

Compose will start this service once an image exists. Until then keep `/health` as the skeleton so G0 has something to ping.
