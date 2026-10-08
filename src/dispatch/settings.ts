// Company settings and the job-type catalogue (ADR 011). The working day
// feeds default shifts and free-time answers; job types decide what a booking
// requires. Nothing here touches the board: a change applies to the next plan
// or the next booking.

import type { IDatabase } from '../db/interface';
import type { JobType } from '../shared/types/domain';
import {
  workingDayProblem,
  type CompanySettings,
  type CreateJobTypeBody,
  type UpdateJobTypeBody,
  type UpdateSettingsBody,
} from '../shared/contracts/settings';

type Refusal = { ok: false; code: string; httpStatus: number; detail: string };
const refuse = (code: string, httpStatus: number, detail: string): Refusal => ({ ok: false, code, httpStatus, detail });

export type CatalogType = JobType & { certs: string[] };

export async function updateSettings(
  db: IDatabase,
  patch: UpdateSettingsBody,
): Promise<{ ok: true; settings: CompanySettings } | Refusal> {
  const next = { ...(await db.settings.get()), ...patch };
  const problem = workingDayProblem(next);
  if (problem) return refuse('invalid_working_day', 400, problem);
  return { ok: true, settings: await db.settings.update(patch) };
}

export async function listJobTypes(db: IDatabase): Promise<CatalogType[]> {
  const types = await db.jobTypes.listAll();
  return Promise.all(types.map(async (t) => ({ ...t, certs: (await db.jobTypes.getCerts(t.id)).map((c) => c.certType) })));
}

/** WATER_LEAK from "Water leak"; a suffix when the id is taken. */
function idFor(name: string, taken: Set<string>): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'JOB_TYPE';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  return id;
}

export async function createJobType(db: IDatabase, body: CreateJobTypeBody): Promise<{ ok: true; jobType: CatalogType } | Refusal> {
  const existing = await db.jobTypes.listAll();
  if (existing.some((t) => t.name.toLowerCase() === body.name.toLowerCase())) {
    return refuse('job_type_exists', 409, `There is already a job type called ${body.name}.`);
  }
  return db.transaction(async (tx) => {
    const created = await tx.jobTypes.create({
      id: idFor(body.name, new Set(existing.map((t) => t.id))),
      name: body.name,
      minTier: body.minTier,
      difficulty: Math.min(5, body.minTier + 1),
      defaultMinutes: body.defaultMinutes,
      brandSensitive: false,
    });
    const certs = await tx.jobTypes.setCerts(created.id, body.certs);
    return { ok: true as const, jobType: { ...created, certs: certs.map((c) => c.certType) } };
  });
}

export async function updateJobType(
  db: IDatabase,
  id: string,
  body: UpdateJobTypeBody,
): Promise<{ ok: true; jobType: CatalogType } | Refusal> {
  const current = await db.jobTypes.getById(id);
  if (!current) return refuse('job_type_not_found', 404, `No job type ${id}.`);
  if (body.name && body.name.toLowerCase() !== current.name.toLowerCase()) {
    const clash = (await db.jobTypes.listAll()).some((t) => t.id !== id && t.name.toLowerCase() === body.name!.toLowerCase());
    if (clash) return refuse('job_type_exists', 409, `There is already a job type called ${body.name}.`);
  }
  return db.transaction(async (tx) => {
    const { certs, ...fields } = body;
    const updated = Object.keys(fields).length ? await tx.jobTypes.update(id, fields) : current;
    const certRows = certs ? await tx.jobTypes.setCerts(id, certs) : await tx.jobTypes.getCerts(id);
    return { ok: true as const, jobType: { ...updated, certs: certRows.map((c) => c.certType) } };
  });
}
