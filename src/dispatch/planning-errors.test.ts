import { describe, expect, it } from 'vitest';
import { AgentError } from '../agent/runtime/errors';
import { planningError } from './planning-errors';

describe('planningError', () => {
  it('says an event that vanished mid-run was cleared, not that it was malformed', () => {
    // A reset from another desk deletes every event and keeps the board's id,
    // so the run's later re-read finds nothing.
    expect(planningError(new AgentError('EVENT_NOT_FOUND'))).toMatchObject({ code: 'event_gone', httpStatus: 410, retryable: false });
  });

  it('keeps a job missing from the board as an invalid event', () => {
    expect(planningError(new AgentError('EVENT_JOB_NOT_FOUND_ON_BOARD'))).toMatchObject({ code: 'invalid_event_context', httpStatus: 422 });
  });

  it('says a job that already has a technician is not something to plan', () => {
    expect(planningError(new AgentError('JOB_ALREADY_ASSIGNED'))).toMatchObject({ code: 'job_already_assigned', httpStatus: 409 });
  });
});
