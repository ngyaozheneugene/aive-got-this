# ADR 008 — Your workspace, team setup, and a simulation mode

**Status:** Accepted
**Date:** 8 Oct 2026
**Owner:** Deen (finals round, all streams)

## Context

The desk opened on a fully loaded fake company with a "Demo controls" panel. It read as a demo, not as something a dispatcher would start using. Also, one reset endpoint served the only board there was: during this round a reset meant for a local desk landed on the live box and wiped its day.

## Decision

1. **Two workspaces, separate data.**
   - `live` is the company's own.
   - `simulation` is the Eastwind sample day.

   `getDatabase(workspace)` keeps one store per workspace: two in-memory stores, or two Postgres schemas (`live` and `simulation`). Each schema is created, migrated and seeded on first use. The type lives in `src/db/workspace.ts`.
2. **Chosen per request.** The desk sends `x-workspace: live | simulation` on every call (`setDeskWorkspace`). With no header, or an unknown one, a request goes to `live`. The desk reads the choice from the URL: `/desk` or `/desk?mode=simulation`.
3. **Reset is simulation-only.** `POST /api/demo/reset` refuses anything but `x-workspace: simulation` with 403 `reset_simulation_only`. A real workspace cannot be wiped by a demo control.
4. **Your workspace starts empty and follows the calendar.**
   - `buildEmptyScenario` keeps the job-type catalogue and the travel matrix. It has no people, customers or jobs.
   - Its snapshot carries `followsClock: true`, so `boardDate` is always today in Singapore. Commits carry the flag forward.
   - The simulation stays on the day it was seeded until reset.
5. **Team setup.**
   - `GET/POST /api/technicians` and `PATCH /api/technicians/{id}` cover name, tier, home postal code (placed with `src/location/postal`), certificates with optional expiry, parts carried, hours per day and overtime.
   - Legal-gate certificates are flagged automatically.
   - "Take off the team" sets `isActive: false` and keeps their history.
   - New `IDatabase` methods `technicians.update` and `technicians.setCerts`, in both adapters.
6. **Default shifts.** An active technician with no shift row for a day gets a standard `scheduled` shift starting at 08:00 (`withDefaultShifts`). Nobody has to enter shifts for a new team. A stored shift (sick day, late start, seeded clock-in) always wins.
7. **Desk.**
   - Your workspace shows "Your workspace" and a "Try a sample day" button.
   - With nobody on the team, a "Set up your team" card offers "Add your first technician" and "Try a sample day first".
   - A "Team" rail button opens team setup.
   - The simulation shows a "Simulation · Eastwind Aircon sample day" badge with "Exit simulation".
   - Demo controls and Reset appear only in the simulation.
   - The event feed is kept per workspace.

## Consequences

- On the box, the Postgres data in `public` from earlier deploys is no longer read. Your workspace and the simulation start fresh in their own schemas.
- The public `/desk` now opens on an empty workspace. For a demo, use `/desk?mode=simulation` or click "Try a sample day".
- Job types are the built-in catalogue. Editing them, and customer management, are still out of scope (G6 P4).

## Evidence

- `src/dispatch/technicians.test.ts`: day one from empty. Add Aisha and Ben, book a gas top-up, and only Aisha (tier 3, R32) is eligible; the plan validates. Also covers edits, certificate replacement, taking someone off the team, and refusals.
- `src/app/api/workspace.test.ts`: reset refused outside the simulation; a technician added in `live` is invisible in `simulation`.
- `npm run test:pg`: technician edits match memory; two schemas stay isolated, so a simulation reset leaves the live workspace's team intact; the live board follows the clock.
- Desk on Postgres:
  - empty workspace with the set-up card;
  - added a technician, who appears on duty;
  - "Try a sample day" loaded 15 technicians;
  - reset inside the simulation;
  - "Exit simulation" returned to the workspace with its technician;
  - a reset aimed at the live workspace got 403.
