import { AgentError } from '../agent/runtime/errors';
import type { OperationalEventStatus } from '../shared/types/domain';

export class PlanningError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    public readonly detail: string,
    public readonly eventStatus: OperationalEventStatus = 'FAILED',
    /**
     * The request failed for a reason outside the event: the gateway was down,
     * a dependency ran out of time, the caller hung up. Nothing about the event
     * or the board has been shown to be wrong, so burning the event would make
     * an outage permanent - the coordinator would have to re-raise it by hand
     * to try again, mid-demo, for a failure that has already cleared.
     *
     * The caller restores the event to the status it held before planning
     * claimed it, and only when no proposal row was written. A run that got far
     * enough to persist something stays terminal and waits for review.
     */
    public readonly retryable: boolean = false,
  ) { super(code); }
}

/** Public errors never contain provider responses, credentials or arbitrary exceptions. */
export function planningError(error: unknown): PlanningError {
  if (error instanceof PlanningError) return error;
  if (!(error instanceof AgentError)) {
    return new PlanningError('planning_failed', 500, 'Planning could not be completed. No schedule was committed.');
  }
  const code = error.code;
  if (['STALE_SNAPSHOT', 'PLANNING_CONTEXT_CHANGED', 'EVENT_CHANGED'].includes(code)) {
    return new PlanningError('stale_planning_context', 409,
      'The board or event changed during planning. Raise a new event against the current board.', 'SUPERSEDED');
  }
  if (code === 'AGENT_ABORTED') {
    return new PlanningError('planning_cancelled', 408, 'Planning was cancelled. No schedule was committed.', 'FAILED', true);
  }
  if (['GATEWAY_TIMEOUT', 'TOOL_TIMEOUT'].includes(code)) {
    return new PlanningError('planning_timeout', 504, 'A planning dependency exceeded its time limit.', 'FAILED', true);
  }
  if (code.startsWith('GATEWAY_')) {
    return new PlanningError('gateway_unavailable', 503, 'The model gateway could not complete planning.', 'FAILED', true);
  }
  if (code === 'SCHEDULER_NOT_IMPLEMENTED') {
    return new PlanningError('scheduler_unavailable', 503, 'The scheduler is not implemented for this flow.', 'FAILED', true);
  }
  // The event vanished mid-run: a reset (from any desk) clears every event,
  // and keeps the board's id, so no staleness check catches it.
  if (code === 'EVENT_NOT_FOUND') {
    return new PlanningError('event_gone', 410,
      'This event no longer exists. The workspace was probably reset while planning ran.', 'INVALID');
  }
  if (code === 'JOB_ALREADY_STARTED') {
    return new PlanningError('job_already_started', 409, 'That job has started; it cannot be cancelled. Nothing was changed.', 'INVALID');
  }
  if (code === 'JOB_ALREADY_ASSIGNED') {
    return new PlanningError('job_already_assigned', 409, 'That job already has a technician. Nothing was changed.', 'INVALID');
  }
  if (code === 'EVENT_JOB_NOT_FOUND_ON_BOARD') {
    return new PlanningError('invalid_event_context', 422, 'The event must reference a job on the current board.', 'INVALID');
  }
  if (['INVALID_EVENT', 'INVALID_EVENT_PAYLOAD', 'EVENT_AFFECTED_IDS_MISMATCH'].includes(code)) {
    return new PlanningError('invalid_event_context', 422, 'The stored event has an invalid or inconsistent payload.', 'INVALID');
  }
  if (code === 'UNSUPPORTED_EVENT_TYPE') {
    return new PlanningError('unsupported_event_type', 422,
      'This endpoint supports urgent_job, technician_unavailable, job_overrun, place_waiting and job_cancelled only.', 'INVALID');
  }
  if (code === 'EVENT_NOT_PLANNABLE') {
    return new PlanningError('event_not_plannable', 409, 'This event is no longer available for planning.');
  }
  return new PlanningError('agent_failed', 502, 'The agent or a planning tool returned an invalid result.');
}
