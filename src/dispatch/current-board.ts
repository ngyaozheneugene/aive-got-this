import { EASTWIND_DATE } from '../shared/config/demo';
import type { DeskBoard, DeskJobRow, DeskTechnicianRow } from '../shared/types/domain';
import type { IDatabase } from '../db/interface';

export async function getCurrentBoard(db: IDatabase): Promise<DeskBoard> {
  const snapshot = await db.boardSnapshots.getLatest();
  if (!snapshot) {
    throw new Error('NO_BOARD_SNAPSHOT');
  }

  const [technicians, jobs, assignments, shifts] = await Promise.all([
    db.technicians.listActive(),
    db.jobs.listByScheduledDate(EASTWIND_DATE),
    db.assignments.listAll(),
    db.shifts.listByDate(EASTWIND_DATE),
  ]);

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
    date: EASTWIND_DATE,
    snapshot,
    technicians: technicianRows,
    jobs: jobRows,
  };
}
