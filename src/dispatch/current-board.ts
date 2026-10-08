import { boardDate } from './board-date';
import { withDefaultShifts } from './default-shifts';
import type { DeskBoard, DeskJobRow, DeskTechnicianRow } from '../shared/types/domain';
import type { IDatabase } from '../db/interface';

/**
 * The desk's view of one day. Defaults to the board's own day; `date` shows
 * another (tomorrow's bookings) without changing what gets planned.
 */
export async function getCurrentBoard(db: IDatabase, date?: string): Promise<DeskBoard> {
  const snapshot = await db.boardSnapshots.getLatest();
  if (!snapshot) {
    throw new Error('NO_BOARD_SNAPSHOT');
  }

  const today = await boardDate(db);
  const day = date ?? today;
  const [technicians, jobs, allAssignments, storedShifts, settings] = await Promise.all([
    db.technicians.listActive(),
    db.jobs.listByScheduledDate(day),
    db.assignments.listAll(),
    db.shifts.listByDate(day),
    db.settings.get(),
  ]);
  const shifts = withDefaultShifts(storedShifts, technicians, day, settings.dayStart);
  const jobIds = new Set(jobs.map((j) => j.id));
  const assignments = allAssignments.filter((a) => jobIds.has(a.jobId));

  const technicianRows: DeskTechnicianRow[] = [];
  for (const technician of technicians) {
    const assigned = assignments.filter(
      (a) => a.technicianId === technician.id && (a.status === 'accepted' || a.status === 'offered'),
    );
    const loadMinutes = assigned.reduce((sum, a) => {
      const job = jobs.find((j) => j.id === a.jobId);
      return sum + (job?.durationMinutes ?? 0);
    }, 0);
    technicianRows.push({
      technician,
      shift: shifts.find((s) => s.technicianId === technician.id),
      assignedJobIds: assigned.map((a) => a.jobId),
      loadMinutes,
    });
  }

  const jobRows: DeskJobRow[] = [];
  for (const job of jobs) {
    const customer = await db.customers.getById(job.customerId);
    const site = await db.sites.getById(job.siteId);
    if (!customer || !site) continue;
    const assignment = assignments.find(
      (a) => a.jobId === job.id && (a.status === 'accepted' || a.status === 'offered'),
    );
    const technician = assignment
      ? technicians.find((t) => t.id === assignment.technicianId)
      : undefined;
    jobRows.push({ job, customer, site, assignment, technician });
  }

  return {
    date: day,
    today,
    snapshot,
    technicians: technicianRows,
    jobs: jobRows,
    workingDay: { start: settings.dayStart, end: settings.dayEnd },
  };
}
