# ADR 010 — Questions in the report box

**Status:** Accepted
**Date:** 8 Oct 2026
**Owner:** Deen (finals round, all streams)

## Context

Typed reports (ADR 009) turn "what happened" into a change. Coordinators also ask things: "who's free at 3 for a leak?", "why can't Marcus take Raffles Place?", "what's still waiting?", "how busy is Daniel?". The box answered those with a clarifying question.

## Decision

1. **Same box, the model decides.** The reader now offers question tools next to the drafting tools. A report finishes with a `draft_*`; a question finishes with `answer`.
2. **Facts come from code** (`src/agent/reports/questions.ts`), all read-only:
   - `who_is_free(from, to?, jobTypeId?)`: free gaps from shifts and bookings, and qualification from the same Stage A gate planning uses. It also lists people who are free but not qualified, with the reasons.
   - `technician_day(technician)`: hours, stops, free gaps, certificates, parts and load.
   - `why_technician(jobId)`: what the job needs (tier, certificates, parts), who has it, and for every other technician whether they qualify (exact Stage A reasons) and whether they are busy then. Who actually won is the solver's call; this tool reports the hard rules and says so.
   - `board_summary()`: who is away, what is waiting, busiest and quietest.
3. **The model only words the answer.** It must call at least one lookup before `answer`; an answer with no lookup is refused back to it. Its instructions say to state only what the results show, and to say when they don't cover the question. The desk shows the answer with **"Based on"**, a code-written list of the lookups, so a coordinator can see what it checked.
4. **No writes.** Question tools read only. `answer` ends the run with text, nothing else.
5. **Fits the gateway.**
   - Technicians are named in the prompt and resolved to IDs by code (names are much shorter than Postgres IDs). A unique name prefix is accepted; an ambiguous one comes back as an error the model can act on.
   - Tool descriptions are minimal, and strictness is enforced by Zod rather than by the definitions.
   - Older lookup results are trimmed if a conversation nears the 7,500-byte cap. The budget is six model calls.

## Known limits

- Free time ignores drive time, and counts to 18:00 when no finish time is set. The tool result says both.
- Questions see today's board only. "Next week" and history questions are out of scope.

## Evidence

- `src/agent/reports/reader.test.ts`, scripted model (13 cases). The question cases check:
  - "who's free" lists qualified people and excludes the unqualified with reasons;
  - "why can't Marcus take Raffles Place" reports `missing_parts`, with only Siti and Jonah qualifying;
  - an answer without a lookup is refused;
  - name resolution works;
  - the size budget holds across four lookups.
- Live model through the organiser gateway: 12/12, saved to [`team/member-3/typed-reports-live-2026-10-08.json`](../team/member-3/typed-reports-live-2026-10-08.json). The answers were checked by hand against the board: who's free at 3 for a leak, why Marcus can't take Raffles Place (no inverter board, busy), what's waiting (Raffles Place), and how busy Daniel is.
- Desk: asked "Why can't Marcus take the Raffles Place job?" in the simulation. The answer card showed the reason and "Based on" its two lookups.
