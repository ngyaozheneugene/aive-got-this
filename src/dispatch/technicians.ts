// Team setup: adding and editing technicians. Eligibility reads certificates,
// tier, parts and the home area straight from these rows, so a change here is
// in force at the next plan. Nothing here touches the board.

import type { IDatabase } from '../db/interface';
import type { Technician, TechnicianCert } from '../shared/types/domain';
import {
  LEGAL_GATE_CERTS,
  type CreateTechnicianBody,
  type UpdateTechnicianBody,
} from '../shared/contracts/technicians';
import { CLUSTER_REGION, clusterForPostal } from '../location/postal';
import { boardDate } from './board-date';
import { nameKey } from './roster-check';

export type TeamMember = Technician & { certs: TechnicianCert[] };

export type TechnicianResult =
  | { ok: true; technician: TeamMember }
  | { ok: false; code: string; httpStatus: number; detail: string };

const refuse = (code: string, httpStatus: number, detail: string): TechnicianResult => ({ ok: false, code, httpStatus, detail });

/** Everyone on file, active or not, with their certificates. */
export async function listTeam(db: IDatabase): Promise<TeamMember[]> {
  const techs = await db.technicians.listAll();
  return Promise.all(techs.map(async (t) => ({ ...t, certs: await db.technicians.getCerts(t.id) })));
}

async function certRows(db: IDatabase, certs: CreateTechnicianBody['certs']) {
  // Issued as of today, so they count from the first plan; expiry as given.
  const today = await boardDate(db);
  return certs.map((c) => ({
    certType: c.type,
    issuedAt: today,
    expiresAt: c.expiresAt,
    isLegalGate: LEGAL_GATE_CERTS.includes(c.type),
  }));
}

export async function createTechnician(db: IDatabase, body: CreateTechnicianBody): Promise<TechnicianResult> {
  const cluster = clusterForPostal(body.homePostalCode);
  if (!cluster) return refuse('unknown_postal_code', 422, `Postal code ${body.homePostalCode} is not one we can place.`);
  const certs = await certRows(db, body.certs);
  return db.transaction(async (tx) => {
    const tech = await tx.technicians.create({
      name: body.name,
      tier: body.tier,
      homeRegion: CLUSTER_REGION[cluster],
      currentCluster: cluster,
      maxMinutesDay: body.maxMinutesDay,
      acceptsOt: body.acceptsOt,
      parts: body.parts,
      tools: [],
      isActive: true,
    });
    const saved = await tx.technicians.setCerts(tech.id, certs);
    return { ok: true as const, technician: { ...tech, certs: saved } };
  });
}

export async function updateTechnician(db: IDatabase, id: string, body: UpdateTechnicianBody): Promise<TechnicianResult> {
  const existing = await db.technicians.getById(id);
  if (!existing) return refuse('technician_not_found', 404, `No technician ${id}.`);
  let cluster: ReturnType<typeof clusterForPostal> = null;
  if (body.homePostalCode) {
    cluster = clusterForPostal(body.homePostalCode);
    if (!cluster) return refuse('unknown_postal_code', 422, `Postal code ${body.homePostalCode} is not one we can place.`);
  }
  const certs = body.certs ? await certRows(db, body.certs) : null;
  return db.transaction(async (tx) => {
    const tech = await tx.technicians.update(id, {
      name: body.name,
      tier: body.tier,
      ...(cluster ? { homeRegion: CLUSTER_REGION[cluster], currentCluster: cluster } : {}),
      maxMinutesDay: body.maxMinutesDay,
      acceptsOt: body.acceptsOt,
      parts: body.parts,
      isActive: body.isActive,
    });
    const saved = certs ? await tx.technicians.setCerts(id, certs) : await tx.technicians.getCerts(id);
    return { ok: true as const, technician: { ...tech, certs: saved } };
  });
}

export type BulkTechniciansResult =
  | { ok: true; created: number; technicians: TeamMember[] }
  | { ok: false; code: string; httpStatus: number; detail: string };

/**
 * Add a confirmed roster import (ADR 012): all or nothing, in one transaction.
 * Refuses a name already on the team or repeated in the batch, so importing
 * the same file twice cannot double the team.
 */
export async function createTechniciansBulk(db: IDatabase, bodies: CreateTechnicianBody[]): Promise<BulkTechniciansResult> {
  if (bodies.length === 0) return { ok: true, created: 0, technicians: [] };

  for (const [i, b] of bodies.entries()) {
    if (!clusterForPostal(b.homePostalCode)) {
      return { ok: false, code: 'unknown_postal_code', httpStatus: 422, detail: `Row ${i + 1} (${b.name}): postal code ${b.homePostalCode} is not one we can place.` };
    }
  }
  const team = new Set((await db.technicians.listAll()).map((t) => nameKey(t.name)));
  const seen = new Set<string>();
  const clashes: string[] = [];
  for (const b of bodies) {
    const key = nameKey(b.name);
    if (team.has(key) || seen.has(key)) clashes.push(b.name);
    seen.add(key);
  }
  if (clashes.length) {
    return { ok: false, code: 'duplicate_technicians', httpStatus: 409, detail: `Already on the team or listed twice: ${clashes.join(', ')}.` };
  }

  return db.transaction(async (tx) => {
    const created: TeamMember[] = [];
    for (const body of bodies) {
      const cluster = clusterForPostal(body.homePostalCode)!;
      const tech = await tx.technicians.create({
        name: body.name.trim().replace(/\s+/g, ' '),
        tier: body.tier,
        homeRegion: CLUSTER_REGION[cluster],
        currentCluster: cluster,
        maxMinutesDay: body.maxMinutesDay,
        acceptsOt: body.acceptsOt,
        parts: body.parts,
        tools: [],
        isActive: true,
      });
      const saved = await tx.technicians.setCerts(tech.id, await certRows(tx, body.certs));
      created.push({ ...tech, certs: saved });
    }
    return { ok: true as const, created: created.length, technicians: created };
  });
}
