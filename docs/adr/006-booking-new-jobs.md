# ADR 006 — Booking new jobs from the desk

**Status:** Accepted
**Date:** 7 Oct 2026
**Owner:** Deen (finals round, all streams)

## Context

`urgent_job` only takes the id of a job already on the board. The desk could place the seeded Raffles Place job, but a coordinator taking a call from a new customer had no way to put that job on the board at all.

## Decision

1. **Booking is its own step.** `POST /api/jobs` (`src/dispatch/create-job.ts`) creates an **unassigned** job on the board's day or the next. It never assigns anyone. The desk then raises the usual `urgent_job` event for it, and planning, approval and commit run unchanged. The event contract and the agent do not change. A booking whose planning fails stays on the board as waiting, so the coordinator can retry with "Find a technician".
2. **Contract** (`src/shared/contracts/jobs.ts`): customer name, Singapore phone, postal code, street, optional unit, job type, priority (`urgent`, `on_demand`, `when_available`), window as `HH:MM` on the day, optional date, and an optional note.
   - The phone is normalised (spaces, dashes and `+65` removed).
   - The note is the customer's own words. It is stored as untrusted `noteRaw` and quoted to the model like every other note.
3. **Server rules:**
   - The job type must exist.
   - The window must be at least the job type's duration.
   - The date must be the board's day or the day after.
   - The postal code must be one we can place.
   - A returning customer is found by phone, and their name on file stands.
   - The same postal code and street reuses their site.
   - Everything is written in one transaction.
4. **Requirements come from the job type.** Tier and certificates are written to `job_requirement`, the only place Stage A reads them, the same way the finals board seeds them.
5. **Postal code to cluster** (`src/location/postal`). The sector (the first two digits) gives the URA postal district, which maps to one of the eight travel clusters. It needs no network call and works offline. It agrees with all 51 seeded sites. A sector we cannot place is refused (`unknown_postal_code`).
6. **Map.** A booked address has no hand-placed coordinates, so its pin goes near its cluster's centre, offset by the postal code. The offset is stable for an address and separates neighbours.
7. **Desk.** "New job" sits on the "Needs a technician" header. The form shows the detected area as the postal code is typed. "Book and find options" saves the job and immediately asks for options. The card says whether the caller is a new or returning customer.

## Consequences

- `GET /api/job-types` is added for the form, alongside `POST /api/jobs`. Neither writes the board.
- A demo reset truncates and reseeds, so bookings made during a rehearsal disappear with it.
- Customers are matched by phone only. A business with several numbers becomes several customers until there is a customer-management page (G6 P4).

## Evidence

- `src/location/postal/postal.test.ts`: agrees with every seeded site; landmarks; refusals.
- `src/dispatch/create-job.test.ts`: phone normalisation, refusals, a new customer, a returning customer and site, certificate requirements, and a booked job planned to two valid plans.
- `npm run test:pg`: booking gives the same rows on Postgres as in memory.
- `evals/g-suite/g11-new-job.test.ts` (real solver): four bookings across the island and four job types plan legally on both profiles, inside the customer's window.
