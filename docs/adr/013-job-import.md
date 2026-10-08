# ADR 013 — Importing jobs from a file

**Status:** Accepted
**Date:** 8 Oct 2026
**Owner:** Deen (finals round, all streams); first version by Damon

## Context

Customers' work orders arrive as spreadsheets and exports as often as phone calls. Booking them one at a time through the New job form (ADR 006) is slow. Damon's first version repeated the roster import's original problems (ADR 012):
- the whole file went in one request (up to 8,000 characters);
- failures fell back silently to guesses;
- postal codes were padded;
- the bulk booking copied the single-booking code;
- importing twice booked every job twice.

## Decision

1. **Same shape as roster import.**
   - `POST /api/jobs/import/draft` reads a file into preview rows and writes nothing.
   - The coordinator edits or removes rows.
   - `POST /api/jobs/bulk` books the confirmed rows in one transaction.
   - Booked jobs wait on the board for a technician, exactly like a single booking. Nothing is assigned by importing.
2. **One reader core** (`src/agent/reports/import-core.ts`), shared with roster import.
   - It turns a file into sections and records, reads them with the assistant three at a time with split-and-retry, and falls back to keywords, labelled.
   - `job-reader.ts` supplies what a job is: the template, the assistant's instructions, the check against the row, and keyword reading.
   - The Excel decoder now turns Excel's time cells into `HH:MM` instead of a date in 1899.
3. **The workspace's own job types.**
   - The assistant is offered the workspace's job types by id and name. A type it returns that the workspace does not have is discarded, and the record's own service column is matched instead, by shared word stems ("Regular Servicing" → General Aircon Service).
   - Only a clear winner counts; anything else is "choose the kind of job".
4. **Code checks the assistant against the row.**
   - Customer, phone, postal code, address and unit must be in the record. Each window time's hour must be written in it.
   - Otherwise the field is left blank, with a note.
5. **Unclear means blank.**
   - An unknown priority, a window that ends before it starts or is shorter than the job, a non-Singapore phone, or an unplaceable postal code each becomes an issue the coordinator fixes in the preview.
   - The checks (`src/dispatch/job-import-check.ts`) are the booking contract's own. The preview re-runs them on every edit.
6. **No double booking.**
   - A row with the same phone, postal code, job type, day and start as a job already on today's or tomorrow's board, or as an earlier row, is flagged.
   - `POST /api/jobs/bulk` refuses it with 409 `duplicate_jobs`.
7. **Bulk booking reuses single booking.**
   - `checkBooking` holds every check `createJob` makes before writing. The bulk route runs it on every row first; the in-memory adapter cannot roll back, so nothing is written until all rows pass.
   - Then each row is booked through `createJob` inside one transaction.
8. **Limits:** 2 MB per file and 200 jobs per import, as for rosters.

## Contract changes

`src/shared/contracts/jobs.ts`:
- `bulkCreateJobsBodySchema`, with a limit of 200;
- `JobCandidateRow`: `sourceRow` and `readBy`, with `null` for unclear type, priority, window and date;
- `ParseJobsResponse`: `candidates`, `skipped`, `context` (today, job types, booked keys), `assistantUnavailable`.

## Not included

Placing the imported jobs. Each waits for "Find a technician", as a single booking does. Planning several waiting jobs in one go is a separate change.

## Evidence

- `src/agent/reports/job-reader.test.ts`, 9 cases:
  - template CSV, Excel (times and the dropped zero) and Parquet;
  - unknown types and priorities left open;
  - the assistant in batches within the request limit, with our types offered;
  - invented values left blank;
  - type recovered from the row;
  - the keyword fallback reading the whole messy list correctly;
  - the scrambled export in three formats with no valid row;
  - duplicates.
- Route tests: types the workspace does not offer are flagged; a second import is refused, and the preview flags it first; an oversized upload is refused.
- Live model, 2/2 ([evidence](../team/member-3/job-import-live-2026-10-08.json)):
  - all five messy work orders read correctly by the assistant (type, priority, window, postal code);
  - the scrambled export produced no valid rows: four flagged with reasons, one skipped.
