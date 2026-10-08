// Checks one row of a job import preview (ADR 013). Pure: the server runs it
// on what it read, and the preview re-runs it on every edit, so an issue
// clears as soon as the coordinator fixes the field. Nothing here guesses: a
// value the file did not state clearly arrives as null and stays an issue.

import { CLUSTER_LABEL, clusterForPostal } from '../location/postal';
import { addDays } from '../shared/config/demo';
import { createJobBodySchema, type CreateJobBody, type JobCandidateRow, type ParseJobsResponse } from '../shared/contracts/jobs';

/** The booking contract's own normalisation: spaces, dashes and a +65 prefix go. */
export const normalizePhone = (raw: string) => raw.trim().replace(/[\s-]/g, '').replace(/^\+?65(?=\d{8}$)/, '');

/** Same customer, place, kind of job, day and start: the same booking. */
export const bookingKey = (b: { phone: string; postalCode: string; jobTypeId: string; date: string; windowStart: string }) =>
  [normalizePhone(b.phone), b.postalCode, b.jobTypeId, b.date, b.windowStart].join('|');

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

type Fields = Omit<JobCandidateRow, 'cluster' | 'isValid' | 'issues'>;

export function checkJobs(rows: Fields[], context: ParseJobsResponse['context']): JobCandidateRow[] {
  const booked = new Set(context.booked);
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const issues: string[] = [];
    if (!row.customerName.trim()) issues.push('Needs the customer’s name.');
    if (!/^[3689]\d{7}$/.test(normalizePhone(row.phone))) issues.push(row.phone ? `${row.phone} is not a Singapore phone number.` : 'Needs a phone number.');
    const cluster = /^\d{6}$/.test(row.postalCode) ? clusterForPostal(row.postalCode) : null;
    if (!row.postalCode) issues.push('Needs the postal code.');
    else if (!cluster) issues.push(`${row.postalCode} is not a Singapore postal code we can place.`);
    if (!row.address.trim()) issues.push('Needs the street address.');

    const type = context.jobTypes.find((t) => t.id === row.jobTypeId);
    if (!type) issues.push('Choose the kind of job.');
    if (!row.priority) issues.push('Choose a priority.');
    if (!row.windowStart || !row.windowEnd) issues.push('Set the time window.');
    else if (row.windowEnd <= row.windowStart) issues.push('The window must end after it starts.');
    else if (type && minutes(row.windowEnd) - minutes(row.windowStart) < type.defaultMinutes) {
      issues.push(`A ${type.name} takes ${type.defaultMinutes} minutes; the window is ${minutes(row.windowEnd) - minutes(row.windowStart)}.`);
    }
    const date = row.date ?? context.today;
    if (date !== context.today && date !== addDays(context.today, 1)) issues.push(`Jobs can be booked for ${context.today} or the day after.`);

    if (!issues.length) {
      const key = bookingKey({ phone: row.phone, postalCode: row.postalCode, jobTypeId: row.jobTypeId!, date, windowStart: row.windowStart! });
      if (booked.has(key)) issues.push('Already booked: same customer, place, job and time.');
      else if (seen.has(key)) issues.push(`Same booking as row ${seen.get(key)}.`);
      else seen.set(key, row.sourceRow);
    }
    if (!issues.length) {
      const parsed = createJobBodySchema.safeParse(toJobBody(row));
      if (!parsed.success) issues.push(...parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
    }
    return { ...row, cluster: cluster ? CLUSTER_LABEL[cluster] : null, isValid: issues.length === 0, issues };
  });
}

/** The booking body for a checked row. Only call on a row with no issues. */
export function toJobBody(row: Fields): CreateJobBody {
  return {
    customerName: row.customerName.trim(),
    phone: normalizePhone(row.phone),
    postalCode: row.postalCode,
    address: row.address.trim(),
    ...(row.unitNo.trim() ? { unitNo: row.unitNo.trim() } : {}),
    jobTypeId: row.jobTypeId ?? '',
    priority: row.priority ?? 'on_demand',
    windowStart: row.windowStart ?? '',
    windowEnd: row.windowEnd ?? '',
    ...(row.date ? { date: row.date } : {}),
    ...(row.note.trim() ? { note: row.note.trim().slice(0, 1000) } : {}),
  };
}
