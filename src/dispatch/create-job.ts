// Booking a job that is not on the board yet. The job lands unassigned on the
// board's day; it is placed the way any waiting job is, through an urgent_job
// event, planning and the commit path. Nothing here assigns a technician.

import type { IDatabase } from '../db/interface';
import type { CreateJobBody } from '../shared/contracts/jobs';
import type { Customer, Job, Site } from '../shared/types/domain';
import { addDays } from '../shared/config/demo';
import { CLUSTER_REGION, clusterForPostal } from '../location/postal';
import { boardDate } from './board-date';

export type CreateJobResult =
  | { ok: true; job: Job; customer: Customer; site: Site; customerIsNew: boolean }
  | { ok: false; code: string; httpStatus: number; detail: string };

const refuse = (code: string, httpStatus: number, detail: string): CreateJobResult => ({ ok: false, code, httpStatus, detail });

export async function createJob(db: IDatabase, body: CreateJobBody): Promise<CreateJobResult> {
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
