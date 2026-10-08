# ADR 012 — Importing a team roster

**Status:** Accepted
**Date:** 8 Oct 2026
**Owner:** Deen (finals round, all streams); first version by Damon

## Context

Typing in a team one technician at a time (ADR 008) is fine for five people and tedious for fifty. Companies keep their roster in a spreadsheet, rarely in our template, and often messy: free-text certificates, addresses holding the postal code, one fact per line, blocks and a table on the same sheet.

Damon's first version read the standard template with code and sent other files to the assistant whole. Review found:
- files over about 4,700 characters exceeded the gateway's 7,500-byte request cap;
- the 500-token reply holds only a few technicians;
- both failures fell back silently to keyword matching that guessed (tier 99 became 2, "-12.5 hrs" became 2 h, the first six digits of a phone number became a postal code);
- the outdated `xlsx` package from npm has known advisories;
- importing twice doubled the team;
- uploads had no size limit.

## Decision

1. **Read, check, then confirm.**
   - `POST /api/technicians/import/draft` reads a file into preview rows and writes nothing.
   - The coordinator edits or removes rows.
   - `POST /api/technicians/bulk` adds the confirmed rows in one transaction, all or nothing.
2. **The server reads every format.** CSV, Excel `.xlsx` (`read-excel-file` 9.3.10) and Parquet (`hyparquet`) become one grid of text cells. Old `.xls` is refused with "save as .xlsx or .csv". Uploads are capped at 2 MB, and imports at 200 technicians.
3. **Sections and records.**
   - The grid is split at blank rows.
   - A section with mostly one value per row is blocks. A row like `[Technician: …]` starts a person; without such markers, each line is one person.
   - Any other section is a table: its header plus one person per row.
   - Every preview row carries the file row it came from.
4. **Who reads what, and the preview says which.** Each row is labelled `template`, `assistant` or `keywords`.
   - **Template:** tables in the standard template are read by code.
   - **Assistant:** other records go three per request, as escaped `UNTRUSTED_DATA`, with one tool, `submit_technicians`.
     - A reply that is unusable (cut off, prose, a failed request) is split in half and retried.
     - A record the assistant leaves out is asked about once on its own, then listed under "not read as technicians". Nothing disappears unexplained.
   - **Keywords:** when the gateway is not configured or keeps failing, rows are read by keyword matching and labelled, and the preview says so.
5. **Code checks the assistant against the row.**
   - A name, postal code or certificate expiry date that is not in the record is left blank, with a note.
   - A tier the assistant leaves out is read from the record's own tier field by the same rules as the template.
6. **Unclear means blank, never a guess.**
   - A tier outside 1–4 or hours outside 2–12 a day become an issue the coordinator must fix in the preview. Hours missing entirely default to 8, with a note.
   - Postal codes are standalone 6-digit numbers, so a phone number never yields one.
   - One deliberate repair: a 5-digit value in a postal column gets its leading zero back, because spreadsheets drop it (048581 becomes 48581). A note says so.
7. **Duplicates.**
   - The preview flags a name already on the team or repeated in the file (`src/dispatch/roster-check.ts`). The preview re-runs these checks on every edit, so fixing a field clears its issue.
   - The bulk route refuses duplicates (409 `duplicate_technicians`), so the same file imported twice adds no one.

## Contract changes

All in `src/shared/contracts/technicians.ts`:
- `bulkCreateTechniciansSchema` (at most 200);
- `RosterCandidateRow`, which adds `sourceRow` and `readBy`, and allows `tier` and `maxMinutesDay` to be `null`;
- `ParseRosterResponse`: `candidates`, `skipped`, `teamNames`, `assistantUnavailable`.

## Evidence

- `src/agent/reports/roster-reader.test.ts`, 16 cases:
  - every sample file, including Excel, Parquet and the mixed sheet;
  - the request size budget for a 40-person file;
  - invented values left blank;
  - cut-off replies split, dropped rows retried, a failing gateway labelled;
  - quoting, phone numbers, the scrambled file, and duplicate checks.
- Route and dispatch tests:
  - a duplicate import is refused, and the preview flags it first;
  - oversized and `.xls` uploads are refused with a plain reason;
  - bulk import is atomic.
- Live model through the organiser gateway, 3/3 ([evidence](../team/member-3/roster-import-live-2026-10-08.json)):
  - the messy spreadsheet and the mixed sheet were read correctly, every row by the assistant;
  - the scrambled file produced no valid rows: two flagged, three listed as skipped.
  - The first live run found the cut-off replies and the dropped row that led to batches of three, split-and-retry, and the tier backstop.
- Desk, simulation:
  - the messy sample read 5 of 5 by the assistant;
  - renaming a row to "Kumar" flagged "already on the team";
  - confirming added the other four (15 became 19).
