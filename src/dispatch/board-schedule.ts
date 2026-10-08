// The one place that answers "what is on the board right now?" for the scheduler.
//
// Assignment rows are the source of truth, not `board_snapshot.snapshotData`.
// The snapshot is an immutable record written only at commit time: between
// commits it is stale by construction, and the seeded v1 snapshot carries only
// assignment *ids*, so reading the blob handed propose() an empty board and an
// empty travel matrix.
//
// The snapshot still does the job it is good at - its id is what checkCommit
// compares for staleness. That needs the id, never the contents.
//
// current-board.ts projects the same rows for the desk. Same source, two shapes.

import { boardDate } from './board-date';
import { withDefaultShifts } from './default-shifts';
import type { IDatabase } from '../db/interface';
import type {
  BoardSchedule,
  JobRequirement,
  Shift,
  Site,
  TechnicianCert,
} from '../shared/types/domain';

/**
 * What propose() needs. The three extra collections are not on `BoardSchedule`
 * yet; `src/matching/propose.ts` reaches for them with a cast and silently falls
 * back to the Eastwind fixture when they are absent, which would plan against
 * fixture certificates instead of real ones. Supplying them makes that fallback
 * unreachable. Folding them into the published contract is member 2's call.
 */
export type PlanningSchedule = BoardSchedule & {
  certs: TechnicianCert[];
  shifts: Shift[];
  jobRequirements: JobRequirement[];
  /**
   * Sites carry `estateCluster`, which is how a job turns into a point on the
   * travel matrix. Without them propose() had no way to ask "how far is this
   * job?" and hardcoded every destination to the CBD, which is correct for
   * Raffles Place and wrong for the other eleven jobs on the board.
   */
  sites: Site[];
};

export async function buildBoardSchedule(db: IDatabase): Promise<PlanningSchedule> {
  const snapshot = await db.boardSnapshots.getLatest();
  if (!snapshot) {
    throw new Error('NO_BOARD_SNAPSHOT');
  }

  const date = await boardDate(db);
  const [technicians, jobs, allAssignments, storedShifts, travel] = await Promise.all([
    db.technicians.listActive(),
    db.jobs.listByScheduledDate(date),
    db.assignments.listAll(),
    db.shifts.listByDate(date),
    db.travelMatrix.listAll(),
  ]);
  const shifts = withDefaultShifts(storedShifts, technicians, date);

  // Only live rows are the board. Superseded and cancelled rows stay in the
  // table for the audit trail but must not be planned around. Other days'
  // bookings are not this board either.
  const jobIds = new Set(jobs.map((j) => j.id));
  const assignments = allAssignments.filter(
    (a) => (a.status === 'accepted' || a.status === 'offered') && jobIds.has(a.jobId),
  );

  const certs: TechnicianCert[] = [];
  for (const technician of technicians) {
    certs.push(...(await db.technicians.getCerts(technician.id)));
  }

  const jobRequirements: JobRequirement[] = [];
  const sites: Site[] = [];
  for (const job of jobs) {
    const requirement = await db.jobRequirements.getByJobId(job.id);
    if (requirement) jobRequirements.push(requirement);
    const site = await db.sites.getById(job.siteId);
    if (site && !sites.some((s) => s.id === site.id)) sites.push(site);
  }

  return {
    date,
    snapshotId: snapshot.id,
    snapshotVersion: snapshot.version,
    technicians,
    jobs,
    assignments,
    travel,
    certs,
    shifts,
    jobRequirements,
    sites,
  };
}
