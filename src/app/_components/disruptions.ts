// The three disruptions the desk can simulate, with the exact event payloads
// the platform accepts. Demo IDs come from the Eastwind fixture; the overrun is
// 90 minutes (not 45) so it collides with Hafiz's 11:00 job and exactly one job
// visibly moves — a 45-minute overrun is absorbed and shows nothing.
// See docs/tasks.md G3 and handover 6.3.
import type { EventBody } from './desk-api';

export interface Disruption {
  key: string;
  label: string;
  detail: string;
  body: EventBody;
}

export const DISRUPTIONS: readonly Disruption[] = [
  {
    key: 'urgent',
    label: 'Urgent job',
    detail: 'Raffles Place chiller trip — a new urgent job needs a slot.',
    body: { type: 'urgent_job', payload: { jobId: 'job_raffles' } },
  },
  {
    key: 'unavailable',
    label: 'Technician unavailable',
    detail: 'Hafiz is off; his remaining jobs must move as a set.',
    body: { type: 'technician_unavailable', payload: { technicianId: 'tech_hafiz' } },
  },
  {
    key: 'overrun',
    label: 'Job overrun (+90 min)',
    detail: 'Hafiz’s 08:00 job runs 90 minutes over and collides with his 11:00.',
    body: { type: 'job_overrun', payload: { jobId: 'job_hafiz_1', overrunMinutes: 90 } },
  },
];

export function findDisruption(key: string): Disruption {
  return DISRUPTIONS.find((d) => d.key === key) ?? DISRUPTIONS[0]!;
}
