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

import { EASTWIND_DATE } from '../shared/config/demo';
import type { IDatabase } from '../db/interface';
import type {
  BoardSchedule,
  JobRequirement,
  Shift,
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
};

export async function buildBoardSchedule(db: IDatabase): Promise<PlanningSchedule> {
  const snapshot = await db.boardSnapshots.getLatest();
  if (!snapshot) {
    throw new Error('NO_BOARD_SNAPSHOT');
  }

  const [technicians, jobs, allAssignments, shifts, travel] = await Promise.all([
    db.technicians.listActive(),
    db.jobs.listByScheduledDate(EASTWIND_DATE),
    db.assignments.listAll(),
    db.shifts.listByDate(EASTWIND_DATE),
    db.travelMatrix.listAll(),
  ]);

  // Only live rows are the board. Superseded and cancelled rows stay in the
  // table for the audit trail but must not be planned around.
  const assignments = allAssignments.filter(
    (a) => a.status === 'accepted' || a.status === 'offered',
  );

  const certs: TechnicianCert[] = [];
  for (const technician of technicians) {
    certs.push(...(await db.technicians.getCerts(technician.id)));
  }

  const jobRequirements: JobRequirement[] = [];
  for (const job of jobs) {
    const requirement = await db.jobRequirements.getByJobId(job.id);
    if (requirement) jobRequirements.push(requirement);
  }

  return {
    date: EASTWIND_DATE,
    snapshotId: snapshot.id,
    snapshotVersion: snapshot.version,
    technicians,
    jobs,
    assignments,
    travel,
    certs,
    shifts,
    jobRequirements,
  };
}
