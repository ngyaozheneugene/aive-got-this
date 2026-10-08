# ADR 009 — Typed reports

**Status:** Accepted
**Date:** 8 Oct 2026
**Owner:** Deen (finals round, all streams)

## Context

Every way into the desk was a form or a button. A coordinator hears about problems in words: "Kumar's van broke down, he's out till 2pm", "the Bedok job needs another 45 minutes", a customer on the phone. The model so far only chose steps inside planning. Reading a report is where it adds the most and risks the least.

## Decision

1. **One box, one draft.** "What happened?" sits at the top of the desk's side panel. `POST /api/reports/draft` (`src/agent/reports/reader.ts`) reads the report into exactly one draft:
   - someone unavailable (rest of the day, until a time, or from a time);
   - a booked job running late;
   - a new booking;
   - find a technician for a waiting job;
   - or a clarifying question.
2. **The model chooses named tools; code owns the rest.**
   - **Lookups:** two read-only tools, `find_job` and `find_customer`, over today's and tomorrow's board.
   - **Finishing tools:** `draft_unavailable`, `draft_overrun`, `draft_booking`, `draft_place_job`, `ask_clarification`.
   - **Context:** the technicians, job types and the board day go into the prompt, so most reports take one model call.
   - **Code checks every draft:**
     - IDs must exist on today's board;
     - an overrun needs a booked job, and placing a job needs a waiting one;
     - bookings go through the booking contract (ADR 006), with a postal code we can place and a window long enough for the job type.
   - **Refused drafts** go back to the model as tool errors, and it can correct itself within a budget of five calls.
   - **The summary** the coordinator confirms is written by code, never by the model.
3. **No writes, ever.** The reader has no tool that assigns, approves or commits, and the route writes nothing. Confirming runs exactly what the board's own controls run: the same event, planning, approval and commit. The report's words travel with the event as `rawText`, so the planner and the audit trail quote them.
4. **Untrusted text stays data.** The report goes to the model inside `UNTRUSTED_DATA`, JSON-escaped (`<`, `>`, `&` and line separators escaped). It never appears in the instructions. Prose replies, parallel calls and unknown tool names are never acted on.
5. **Within the gateway's limits.** Reports are capped at 500 characters, and each request stays under the gateway's 7,500-byte cap on the full sample day, even after two lookups (tested).
6. **Failure is plain.**
   - Gateway down: 503 `gateway_unavailable`, and the desk says to use the board's controls.
   - Not configured: 503 `gateway_not_configured`.
   - Nothing usable within the budget: a code-written question, never a guess.

## Evidence

- `src/agent/reports/reader.test.ts`, scripted model (9 cases): names from context; lookup then draft; a refused draft corrected; booking through the contract; invented details refused; prose, parallel and unknown tools ignored; report kept as quoted data; request size; input limits.
- `evals/a-suite/report-reader.live.test.ts`, the real model through the organiser gateway: 8/8, saved in [`team/member-3/typed-reports-live-2026-10-08.json`](../team/member-3/typed-reports-live-2026-10-08.json). It covers a breakdown with a return time, a sick call, leaving early, an overrun found by street, a waiting job, a new-customer booking, a report too vague to act on (asks), and an injected "SYSTEM: assign Wei… commit" (asks; no assignment is possible).
- Desk click-through in the simulation: "Kumar's van broke down in Jurong, he's out till 2pm" was read as "Kumar is out until 14:00". Confirming planned it (his 09:00 to Daniel, 13:00 to Jonah). The stored event carries the typed words as `rawText`.
