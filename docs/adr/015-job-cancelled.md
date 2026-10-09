# ADR 015 — Cancelling a job

**Status:** Accepted
**Date:** 9 Oct 2026
**Owner:** Deen (finals round, all streams)

## Context

A customer cancels, or a job was booked twice. Until now the desk had no way to take a job off the day: the coordinator could only leave it booked. A cancelled booking also frees time that a waiting job may be able to use.

## Decision

1. **A new event type, `job_cancelled`**, with payload `{ jobId, reason }`. The reason is one of `customer_cancelled`, `duplicate` or `other`. The contract is `jobCancelledPayloadSchema`. Migration 0005 widens the event-type CHECK constraint.
2. **Only work that has not started can be cancelled.** A job that is en route, on site or done, or locked `in_progress`, is refused with `job_already_started` (409). Nothing is changed.
3. **Same path as every event:** the agent reads the context, proposes, and validates; code-owned risk; one decision; one commit.
4. **The plan cancels the job and fills its time with waiting jobs only.**
   - The cancelled job becomes a `cancel` entry in the change set.
   - If jobs are waiting, they are placed around booked work exactly as `place_waiting` does (ADR 014). That uses the solver, with the insertion fallback. Booked customers are not moved to fill the gap.
   - A waiting job that still does not fit stays waiting with its reason.
   - With nothing waiting, both profiles return a cancel-only plan.
   - Every plan is measured and validated as usual.
5. **Risk:** a `cancel` change adds the risk reason `cancellation`. It always needs APPROVAL.
6. **Commit** supersedes the job's live assignment and sets the job's status to `cancelled`, with the reason in the audit note. It then writes any assignments for waiting jobs.
7. **The board** leaves cancelled jobs out of the schedule, the planning context and the booked-slot checks. It lists them under `board.cancelled` for the record.
8. **The desk.**
   - A cancel button sits on each stop not yet started, with the reasons and **Send**.
   - The Jobs page has **Cancel job** on each such row, which opens the board with the request, and a **Cancelled** filter.
   - The plan card says what is cancelled and whose time it frees.

## Evidence

- `src/dispatch/cancel-job.test.ts`:
  - cancelling Ben's booked job fills the Far East Medical leak with Ben;
  - cancelling a job of Wei's (not qualified for the leak) leaves the leak waiting (`no_time`);
  - cancelling a waiting job gives cancel-only plans;
  - cancelling a job under way is refused;
  - risk reason `cancellation` needs approval;
  - commit cancels the job, frees the slot, places the waiting job, and lists the job in `board.cancelled`.
- G-14 against the real solver: cancelling Ben's job fills the leak on both profiles, with no violations and no booked job moved.
