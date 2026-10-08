# ADR 011 — App shell, company settings and job types

**Status:** Accepted
**Date:** 8 Oct 2026
**Owner:** Deen (finals round, all streams)

## Context

Everything lived on one page: team setup was an overlay on the map, and switching to the sample day was a header button. A coordinator setting up a company had nowhere to say what their company is called, when their working day runs, or what kinds of job they take. The working day was hard-coded (08:00 clock-in, free time counted to 18:00), and so was the job-type catalogue.

## Decision

1. **App shell.** A route group `src/app/(app)/` with a shared layout: a sidebar (Dispatch `/desk`, Team `/team`, Settings `/settings`) and the workspace switch in its footer. `/` redirects to `/desk`. The sidebar collapses to an icon rail, and always is one on narrow screens.
2. **The workspace belongs to the shell, not the desk.** `WorkspaceProvider` chooses `live` or `simulation` from `?mode=`, then from what this browser last used, then `live`. It loads that workspace's settings before rendering any page, so no request goes to the wrong workspace. Switching remounts every page. Sidebar links carry `?mode=simulation`, so the sample day survives navigation and reloads.
3. **Company settings** (`src/shared/contracts/settings.ts`): `name`, `dayStart`, `dayEnd`, `defaultProfile`.
   - Storage is one `company_setting` row per workspace schema (migration 0003). With no row, the defaults apply: "Your company", 08:00–18:00, `sla_first`.
   - The sample scenario seeds "Eastwind Aircon", and a reset restores it. A simulation seeded before 0003 gets that row on start, and a stored row is never overwritten.
   - **`dayStart`** is the default clock-in for anyone without a stored shift, on the board and in planning.
   - **`dayEnd`** is where free-time answers stop when no finish time is set (ADR 010). Both reach the desk as `DeskBoard.workingDay` (optional) and the day bar spans them.
   - **`defaultProfile`** is the option the desk recommends first. A coordinator can still switch for one event.
   - The working day must be at least four hours, start before end.
   - Hard rules are unchanged: tiers, certificates, parts and validation are still code.
4. **Job types are editable.** `POST /api/job-types` and `PATCH /api/job-types/{id}` set name, typical minutes, lowest tier and required certificates.
   - Ids come from the name (`DUCT_CLEANING`). Names are unique, case-insensitively.
   - A change applies to new bookings. Jobs already booked keep the requirement rows they were created with, so a planned day never changes underneath the coordinator.
5. **Team is a page.** The same fields as before (ADR 008), with search, and the editor beside the list.

## Not included

Customers and Jobs pages and the Activity log are the next steps of the layout. Deleting a job type is not offered, because jobs reference it.

## Evidence

- `src/dispatch/settings.test.ts`:
  - defaults, and Eastwind in the sample day;
  - a working day that is too short is refused;
  - `dayStart` moves the default clock-in, and `dayEnd` the end of free time;
  - a reset restores settings;
  - a new job type's certificates and duration reach a booking;
  - an edit leaves booked jobs alone.
- `test:pg` 17/17: settings and job types store the same way on Postgres and in memory, including after a reset; migration 0003 applies once.
- Desk on Postgres, in the simulation:
  - set the day to 07:30 and the default to Least disruption;
  - added a job type;
  - Dispatch then opened on Least disruption and recommended accordingly for Raffles Place;
  - "Reset the sample day" in Settings restored Eastwind's settings and removed the added type.
