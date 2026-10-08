// Booking a job that is not on the board yet. The job lands unassigned on the
// board's day; it is placed the way any waiting job is, through an urgent_job
// event, planning and the commit path. Nothing here assigns a technician.

import type { IDatabase } from '../db/interface';
import type { CreateJobBody } from '../shared/contracts/jobs';
import type { Customer, Job, JobType, Site } from '../shared/types/domain';
import { bookingKey } from './job-import-check';
import { addDays } from '../shared/config/demo';
import { CLUSTER_REGION, clusterForPostal } from '../location/postal';
import { boardDate } from './board-date';

export type CreateJobResult =
  | { ok: true; job: Job; customer: Customer; site: Site; customerIsNew: boolean }
  | { ok: false; code: string; httpStatus: number; detail: string };

const refuse = (code: string, httpStatus: number, detail: string) => ({ ok: false as const, code, httpStatus, detail });

type Checked = { ok: true; cluster: NonNullable<ReturnType<typeof clusterForPostal>>; jobType: JobType; date: string; windowStart: string; windowEnd: string };

/** Everything that can refuse a booking, checked before anything is written. */
export async function checkBooking(db: IDatabase, body: CreateJobBody): Promise<Checked | Extract<CreateJobResult, { ok: false }>> {
  const cluster = clusterForPostal(body.postalCode);
  if (!cluster) return refuse('unknown_postal_code', 422, `Postal code ${body.postalCode} is not one we can place on the map.`);

  const jobType = await db.jobTypes.getById(body.jobTypeId);
  if (!jobType) return refuse('unknown_job_type', 422, `No job type ${body.jobTypeId}.`);

  const today = await boardDate(db);
  const date = body.date ?? today;
  if (date !== today && date !== addDays(today, 1)) {
    return refuse('date_out_of_range', 422, `Jobs can be booked for ${today} or the day after.`);
  }

  const windowStart = `${date}T${body.windowStart}:00+08:00`;
  const windowEnd = `${date}T${body.windowEnd}:00+08:00`;
  const windowMinutes = (Date.parse(windowEnd) - Date.parse(windowStart)) / 60000;
  if (windowMinutes < jobType.defaultMinutes) {
    return refuse(
      'window_too_short',
      422,
      `A ${jobType.name} takes ${jobType.defaultMinutes} minutes; the window is ${windowMinutes}.`,
    );
  }

  return { ok: true, cluster, jobType, date, windowStart, windowEnd };
}

export async function createJob(db: IDatabase, body: CreateJobBody): Promise<CreateJobResult> {
  const checked = await checkBooking(db, body);
  if (!checked.ok) return checked;
  const { cluster, jobType, date, windowStart, windowEnd } = checked;
  const certs = (await db.jobTypes.getCerts(jobType.id)).map((c) => c.certType);

  return db.transaction(async (tx) => {
    // A returning customer is found by phone; their name on file stands.
    const existing = await tx.customers.getByPhone(body.phone);
    const customer =
      existing ?? (await tx.customers.create({ name: body.customerName, phone: body.phone }));

    // Same customer, same postal code and street: the same site.
    const sites = await tx.sites.getByCustomerId(customer.id);
    const sameAddress = (s: Site) =>
      s.postalCode === body.postalCode && s.addressLine1.trim().toLowerCase() === body.address.trim().toLowerCase();
    const site =
      sites.find(sameAddress) ??
      (await tx.sites.create({
        customerId: customer.id,
        postalCode: body.postalCode,
        region: CLUSTER_REGION[cluster],
        estateCluster: cluster,
        addressLine1: body.address,
        unitNo: body.unitNo ?? '',
        accessFlags: [],
      }));

    const job = await tx.jobs.create({
      customerId: customer.id,
      siteId: site.id,
      jobTypeId: jobType.id,
      status: 'unassigned',
      priority: body.priority,
      windowType: body.priority === 'urgent' ? 'tight' : 'loose',
      lockState: 'none',
      scheduledDate: date,
      windowStart,
      windowEnd,
      durationMinutes: jobType.defaultMinutes,
      partsRequired: [],
      toolsRequired: [],
      noteRaw: body.note ?? '',
      requiredCrewSize: 1,
      boardVersionAtRank: 1,
      confidenceScore: 1,
    });

    // Stage A reads tier and certificates only through this row.
    await tx.jobRequirements.create({
      jobId: job.id,
      minTier: jobType.minTier,
      requiredCerts: certs,
      requiredCrewSize: 1,
    });

    return { ok: true as const, job, customer, site, customerIsNew: !existing };
  });
}

export type BulkJobsResult =
  | { ok: true; created: number; jobs: Job[] }
  | { ok: false; code: string; httpStatus: number; detail: string };

/**
 * Book a confirmed job import (ADR 013): every row is checked before anything
 * is written, a job already booked (or listed twice) is refused, then each is
 * booked exactly as a single booking is, in one transaction.
 */
export async function createJobsBulk(db: IDatabase, bodies: CreateJobBody[]): Promise<BulkJobsResult> {
  if (bodies.length === 0) return { ok: true, created: 0, jobs: [] };
  const today = await boardDate(db);
  for (const [i, body] of bodies.entries()) {
    const checked = await checkBooking(db, body);
    if (!checked.ok) return { ...checked, detail: `Row ${i + 1} (${body.customerName}): ${checked.detail}` };
  }

  const booked = new Set(await bookedKeys(db, today));
  const seen = new Set<string>();
  const clashes: string[] = [];
  for (const body of bodies) {
    const key = bookingKey({ ...body, date: body.date ?? today });
    if (booked.has(key) || seen.has(key)) clashes.push(`${body.customerName} ${body.windowStart}`);
    seen.add(key);
  }
  if (clashes.length) {
    return { ok: false, code: 'duplicate_jobs', httpStatus: 409, detail: `Already booked or listed twice: ${clashes.join(', ')}.` };
  }

  try {
    return await db.transaction(async (tx) => {
      const jobs: Job[] = [];
      for (const body of bodies) {
        const made = await createJob(tx, body);
        if (!made.ok) throw new BulkRefusal(made);
        jobs.push(made.job);
      }
      return { ok: true as const, created: jobs.length, jobs };
    });
  } catch (e) {
    if (e instanceof BulkRefusal) return e.result;
    throw e;
  }
}

class BulkRefusal extends Error {
  constructor(readonly result: Extract<CreateJobResult, { ok: false }>) {
    super(result.code);
  }
}

/** Duplicate keys for every job booked on the board's day and the next. */
export async function bookedKeys(db: IDatabase, today: string): Promise<string[]> {
  const keys: string[] = [];
  for (const day of [today, addDays(today, 1)]) {
    for (const job of await db.jobs.listByScheduledDate(day)) {
      const [customer, site] = await Promise.all([db.customers.getById(job.customerId), db.sites.getById(job.siteId)]);
      if (!customer || !site || !job.windowStart) continue;
      keys.push(bookingKey({ phone: customer.phone, postalCode: site.postalCode, jobTypeId: job.jobTypeId, date: day, windowStart: job.windowStart.slice(11, 16) }));
    }
  }
  return keys;
}
