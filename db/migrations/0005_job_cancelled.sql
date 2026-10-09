-- 0005: cancelling a job is an event like any other (ADR 015).
ALTER TABLE operational_event DROP CONSTRAINT IF EXISTS operational_event_type_check;
ALTER TABLE operational_event ADD CONSTRAINT operational_event_type_check
    CHECK (type IN ('urgent_job', 'technician_unavailable', 'job_overrun', 'place_waiting', 'job_cancelled'));
