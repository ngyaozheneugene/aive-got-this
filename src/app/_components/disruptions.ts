// The three disruptions the desk can simulate, with the exact event payloads
// the platform accepts. Demo IDs come from the Eastwind fixture; the overrun is
// 90 minutes (not 45) so it collides with Hafiz's 11:00 job and work visibly
// moves: "Least disruption" moves that one job; "On-time first" also hands his
// 14:00 to Wei to even out the day. A 45-minute overrun is absorbed and shows nothing.
// See docs/tasks.md G3 and handover 6.3.
import type { EventBody } from './desk-api';

export interface Disruption {
  key: string;
  /** What the demo presenter picks: what happens out in the field. */
  label: string;
  /** Who it comes from. In real use the event arrives from here by itself. */
  source: string;
  /** How it lands on the coordinator's desk. */
  headline: string;
  detail: string;
  body: EventBody;
}

export const DISRUPTIONS: readonly Disruption[] = [
  {
    key: 'urgent',
    label: 'A customer calls with an urgent job',
    source: 'Customer call',
    headline: 'Urgent job: Raffles Place Capital',
    detail: 'Their chiller has tripped. They need a technician this afternoon, 13:00–17:00.',
    body: { type: 'urgent_job', payload: { jobId: 'job_raffles' } },
  },
  {
    key: 'unavailable',
    label: 'A technician calls in sick',
    source: 'Technician app',
    headline: 'Hafiz is off sick today',
    detail: 'His remaining jobs need someone else.',
    body: { type: 'technician_unavailable', payload: { technicianId: 'tech_hafiz' } },
  },
  {
    key: 'overrun',
    label: 'A job runs late',
    source: 'Technician app',
    headline: 'Hafiz’s 08:00 job is running 90 min late',
    detail: 'It now clashes with his 11:00 job.',
    body: { type: 'job_overrun', payload: { jobId: 'job_hafiz_1', overrunMinutes: 90 } },
  },
];

export function findDisruption(key: string): Disruption {
  return DISRUPTIONS.find((d) => d.key === key) ?? DISRUPTIONS[0]!;
}
