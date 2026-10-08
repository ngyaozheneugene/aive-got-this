// Checks one row of a roster import preview (ADR 012). Pure: the server runs
// it on what it read, and the preview re-runs it on every edit, so an issue
// clears as soon as the coordinator fixes the field. Nothing here guesses:
// a value the file did not state clearly arrives as null and stays an issue.

import { CLUSTER_LABEL, clusterForPostal } from '../location/postal';
import { createTechnicianBodySchema, type CreateTechnicianBody, type RosterCandidateRow } from '../shared/contracts/technicians';

/** "  Ah  Seng " and "ah seng" are the same person for duplicate checks. */
export const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

type Fields = Omit<RosterCandidateRow, 'cluster' | 'isValid' | 'issues'>;

/** Issues for every row, in order: a later row with the same name as an earlier one (or the team) is the duplicate. */
export function checkRoster(rows: Fields[], teamNames: string[]): RosterCandidateRow[] {
  const team = new Set(teamNames.map(nameKey));
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const issues: string[] = [];
    const key = nameKey(row.name);
    if (!key) issues.push('Needs a name.');
    else if (team.has(key)) issues.push(`${row.name.trim()} is already on the team.`);
    else if (seen.has(key)) issues.push(`Same name as row ${seen.get(key)}.`);
    if (key && !seen.has(key)) seen.set(key, row.sourceRow);

    if (row.tier === null) issues.push('Choose a skill tier.');
    const cluster = /^\d{6}$/.test(row.homePostalCode) ? clusterForPostal(row.homePostalCode) : null;
    if (!row.homePostalCode) issues.push('Needs the postal code where their day starts.');
    else if (!cluster) issues.push(`${row.homePostalCode} is not a Singapore postal code we can place.`);
    if (row.maxMinutesDay === null) issues.push('Set hours a day (2 to 12).');
    else if (row.maxMinutesDay < 120 || row.maxMinutesDay > 720) issues.push('Hours a day must be 2 to 12.');

    if (!issues.length) {
      const parsed = createTechnicianBodySchema.safeParse(toBody(row));
      if (!parsed.success) issues.push(...parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
    }
    return { ...row, cluster: cluster ? CLUSTER_LABEL[cluster] : null, isValid: issues.length === 0, issues };
  });
}

/** The create body for a checked row. Only call on a row with no issues. */
export function toBody(row: Fields): CreateTechnicianBody {
  return {
    name: row.name.trim().replace(/\s+/g, ' '),
    tier: row.tier ?? 2,
    homePostalCode: row.homePostalCode,
    certs: row.certs.map((c) => ({ type: c.type, ...(c.expiresAt ? { expiresAt: c.expiresAt } : {}) })),
    parts: row.parts,
    maxMinutesDay: row.maxMinutesDay ?? 480,
    acceptsOt: row.acceptsOt,
  };
}
