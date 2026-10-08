// The three disruptions the desk can simulate, with the exact event payloads
// the platform accepts. Demo IDs come from the Eastwind fixture; the overrun is
// 90 minutes (not 45) so it collides with Hafiz's 11:00 job and work visibly
// moves: "Least disruption" moves that one job; "On-time first" also hands his
// 14:00 to Wei to even out the day. A 45-minute overrun is absorbed and shows nothing.
// See docs/tasks.md G3 and handover 6.3.
import type { DeskJobRow, Technician } from '../../shared/types/domain';
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
  /** The coordinator's own words, when this came from a typed report. Sent as the event's rawText. */
  rawText?: string;
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

// Requests the coordinator raised from a job on the board, by key, for the
// lifetime of the page.
const fromBoard = new Map<string, Disruption>();

export function findDisruption(key: string): Disruption {
  const known = DISRUPTIONS.find((d) => d.key === key) ?? fromBoard.get(key);
  if (known) return known;
  // Raised from the board before a reload: the names are gone with the page,
  // but the key still says what was sent.
  if (key.startsWith('job:')) {
    return { key, label: 'Find a technician', source: 'Your request', headline: 'Find a technician', detail: '', body: { type: 'urgent_job', payload: { jobId: key.slice(4) } } };
  }
  if (key.startsWith('waiting:')) {
    const jobIds = key.slice(8).split(',').filter(Boolean);
    return { key, label: 'Plan all waiting jobs', source: 'Your request', headline: `Find technicians for ${jobIds.length} waiting jobs`, detail: '', body: { type: 'place_waiting', payload: { jobIds } } };
  }
  const off = /^off:([^:]+):(day|until|from)(?::(\d{4}-\d{2}-\d{2}):(\d{2}:\d{2}))?$/.exec(key);
  if (off) {
    const [, technicianId, mode, date, time] = off;
    const availability: Availability = mode === 'day' ? { mode: 'day' } : { mode: mode as 'until' | 'from', time: time! };
    return disruptionForUnavailable({ id: technicianId!, name: 'A technician' }, date ?? '', availability);
  }
  const late = /^late:([^:]+):(\d+)$/.exec(key);
  if (late) {
    const minutes = Number(late[2]);
    return { key, label: 'A job runs late', source: 'Your report', headline: `A job is running ${minutes} min late`, detail: '', body: { type: 'job_overrun', payload: { jobId: late[1]!, overrunMinutes: minutes } } };
  }
  return DISRUPTIONS[0]!;
}

/** A job just booked from the desk, sent for options straight away. */
export function disruptionForBooking(row: DeskJobRow, jobTypeName: string, customerIsNew: boolean): Disruption {
  const ws = row.job.windowStart?.slice(11, 16);
  const we = row.job.windowEnd?.slice(11, 16);
  const d: Disruption = {
    key: `job:${row.job.id}`,
    label: 'New job',
    source: customerIsNew ? 'New customer' : 'Returning customer',
    headline: `New job: ${row.customer.name}`,
    detail: `${jobTypeName} at ${row.site.addressLine1}${ws && we ? `, ${ws}–${we}` : ''}.`,
    body: { type: 'urgent_job', payload: { jobId: row.job.id } },
  };
  fromBoard.set(d.key, d);
  return d;
}

/** When a technician is away: the rest of today, until a time, or from a time. */
export type Availability = { mode: 'day' } | { mode: 'until' | 'from'; time: string };

/** A coordinator marking someone unavailable from the board. `time` is HH:MM on `date`. */
export function disruptionForUnavailable(
  tech: Pick<Technician, 'id' | 'name'>,
  date: string,
  availability: Availability,
): Disruption {
  const at = availability.mode === 'day' ? '' : `${date}T${availability.time}:00+08:00`;
  const key = availability.mode === 'day' ? `off:${tech.id}:day` : `off:${tech.id}:${availability.mode}:${date}:${availability.time}`;
  const copy = {
    day: { headline: `${tech.name} is off for the rest of today`, detail: 'Their jobs that have not started need someone else.' },
    until: { headline: `${tech.name} is out until ${availability.mode === 'day' ? '' : availability.time}`, detail: 'Jobs before then need someone else or a later slot.' },
    from: { headline: `${tech.name} is leaving at ${availability.mode === 'day' ? '' : availability.time}`, detail: 'Jobs after then need someone else.' },
  }[availability.mode];
  const d: Disruption = {
    key,
    label: 'A technician is unavailable',
    source: 'Your report',
    ...copy,
    body: {
      type: 'technician_unavailable',
      payload: {
        technicianId: tech.id,
        ...(availability.mode === 'until' ? { until: at } : {}),
        ...(availability.mode === 'from' ? { from: at } : {}),
      },
    },
  };
  fromBoard.set(d.key, d);
  return d;
}

/** A coordinator reporting that a booked job is running late, by any amount. */
export function disruptionForOverrun(row: DeskJobRow, minutes: number): Disruption {
  const d: Disruption = {
    key: `late:${row.job.id}:${minutes}`,
    label: 'A job runs late',
    source: 'Your report',
    headline: `${row.technician ? `${row.technician.name}’s job at ` : 'The job at '}${row.site.addressLine1} is running ${minutes} min late`,
    detail: `${row.customer.name}. Later jobs may need to move.`,
    body: { type: 'job_overrun', payload: { jobId: row.job.id, overrunMinutes: minutes } },
  };
  fromBoard.set(d.key, d);
  return d;
}

/**
 * The event for a coordinator asking for options on a job already on the
 * board. A job the demo already tells a story about keeps that story (the
 * Raffles Place job came in by phone); any other job gets a plain request.
 */
export function disruptionForJob(row: DeskJobRow): Disruption {
  const scripted = DISRUPTIONS.find(
    (d) => d.body.type === 'urgent_job' && d.body.payload.jobId === row.job.id,
  );
  if (scripted) return scripted;
  const ws = row.job.windowStart?.slice(11, 16);
  const we = row.job.windowEnd?.slice(11, 16);
  const d: Disruption = {
    key: `job:${row.job.id}`,
    label: 'Find a technician',
    source: 'Your request',
    headline: `Find a technician: ${row.customer.name}`,
    detail: `${row.site.addressLine1}${ws && we ? `. Window ${ws}–${we}.` : '.'}`,
    body: { type: 'urgent_job', payload: { jobId: row.job.id } },
  };
  fromBoard.set(d.key, d);
  return d;
}

/** Every job waiting for a technician, placed in one plan (ADR 014). */
export function disruptionForWaiting(rows: DeskJobRow[]): Disruption {
  const names = rows.map((r) => r.customer.name);
  const d: Disruption = {
    key: `waiting:${rows.map((r) => r.job.id).join(',')}`,
    label: 'Plan all waiting jobs',
    source: 'Your request',
    headline: `Find technicians for ${rows.length} waiting jobs`,
    detail: names.length > 4 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more.` : `${names.join(', ')}.`,
    body: { type: 'place_waiting', payload: { jobIds: rows.map((r) => r.job.id) } },
  };
  fromBoard.set(d.key, d);
  return d;
}

/** The same disruption, raised from a typed report: quotes the words and carries them to the event. */
export function fromReport(d: Disruption, text: string): Disruption {
  const reported: Disruption = { ...d, source: 'Typed report', detail: `“${text}”`, rawText: text };
  fromBoard.set(reported.key, reported);
  return reported;
}
