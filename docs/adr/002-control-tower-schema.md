# ADR 002 — Control-tower schema on top of v0.4

**Status:** Accepted
**Date:** 9 Sep 2026
**Owners:** member 1

## Context

`db/schema/schema.sql` was a matching-and-intake schema: Cognito users, 10-minute offers, single-job approval cards, a JSON `board_snapshot`, and WhatsApp `intake_message`. The v1.1 plan needs events, two candidate plans, proposal-level approval, and versioned commits.

Existing people, catalog, job, assignment, travel, and `cert_valid_on` still earn their keep.

## Decision

Keep those tables. Add `operational_event`, `proposal`, `candidate_plan`, and `risk_policy`. Widen `board_snapshot`, `approval`, `decision_log`, `job` (lock, duration, parts/tools), `technician` (cluster, parts/tools), and `app_user` (`demo_login`, nullable `cognito_sub`).

Leave `recurrence` and `intake_message` in place unused (P2). Prefer `risk_policy` over `dispatch_policy`.

`CREATE TABLE IF NOT EXISTS` will not migrate a volume that already applied v0.4. Recreate it: `docker compose down -v` then apply `schema.sql`.

## Consequences

See [`docs/adr/003-g0-contracts.md`](adr/003-g0-contracts.md). TypeScript types and `IDatabase` gained `events`, `proposals`, and `candidatePlans`. Offer/accept remains for a P1 technician flow. Eastwind seed is `src/shared/fixtures/eastwind.ts` (6 technicians, 12 jobs).
