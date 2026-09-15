import { z } from 'zod';
import type { IDatabase } from '../../db/interface';
import { propose } from '../../matching/propose';
import { validatePlan } from '../../matching/validate';
import { urgentJobPayloadSchema, operationalEventSchema } from '../../shared/contracts/events';
import { plannedSlotSchema, proposeOutputSchema, planValidationSchema } from '../../shared/contracts/propose';
import { emptyPlanMetrics } from '../../shared/types/domain';
import type { Assignment, BoardSchedule, CandidatePlan, OperationalEvent, PlanValidation, ProposeInput, ProposeOutput } from '../../shared/types/domain';
import { AgentError } from '../runtime/errors';

export interface PlanningContext {
  event: OperationalEvent;
  schedule: BoardSchedule;
  untrusted: { event_raw: string; job_note_raw: string; site_memory_raw: string[] };
}
export interface SchedulerPort {
  propose(input: ProposeInput): ProposeOutput | Promise<ProposeOutput>;
  validate(plan: CandidatePlan, schedule: BoardSchedule): PlanValidation | Promise<PlanValidation>;
}
export interface UrgentTools extends SchedulerPort {
  readContext(eventId: string, sourceSnapshotId?: string): Promise<PlanningContext>;
}

/** Only reads the database. No SQL, proposals, approvals or board writes. */
export function createUrgentTools(
  db: IDatabase,
  scheduler: SchedulerPort = { propose, validate: validatePlan },
): UrgentTools {
  return {
    async readContext(eventId, expectedSnapshotId) {
      const [storedEvent, snapshot] = await Promise.all([
        db.events.getById(eventId), db.boardSnapshots.getLatest(),
      ]);
      if (!storedEvent) throw new AgentError('EVENT_NOT_FOUND');
      if (!snapshot) throw new AgentError('BOARD_NOT_FOUND');
      const parsed = operationalEventSchema.safeParse(storedEvent);
      if (!parsed.success) throw new AgentError('INVALID_EVENT');
      const event = parsed.data;
      if (event.type !== 'urgent_job') throw new AgentError('UNSUPPORTED_EVENT_TYPE');
      if (!['RECEIVED', 'VALIDATED', 'PLANNING'].includes(event.status) || event.validationIssues.length) {
        throw new AgentError('EVENT_NOT_PLANNABLE');
      }
      const payload = urgentJobPayloadSchema.strict().safeParse(event.normalizedPayload);
      if (!payload.success) throw new AgentError('INVALID_EVENT_PAYLOAD');
      if ((expectedSnapshotId && snapshot.id !== expectedSnapshotId) ||
          (event.sourceSnapshotId && snapshot.id !== event.sourceSnapshotId)) throw new AgentError('STALE_SNAPSHOT');
      const date = snapshot.snapshotData.date;
      if (typeof date !== 'string' || !date) throw new AgentError('INVALID_BOARD_DATE');
      const [technicians, jobs, rows, travel] = await Promise.all([
        db.technicians.listActive(), db.jobs.listByScheduledDate(date),
        db.assignments.listAll(), db.travelMatrix.listAll(),
      ]);
      const job = jobs.find((row) => row.id === payload.data.jobId);
      if (!job) throw new AgentError('EVENT_JOB_NOT_FOUND_ON_BOARD');

      // Seed snapshots store IDs; committed snapshots store the complete slot set.
      // Read the pinned snapshot, not a potentially half-updated active-row set.
      let assignments: Assignment[];
      if (Array.isArray(snapshot.snapshotData.assignments)) {
        const slots = z.array(plannedSlotSchema).safeParse(snapshot.snapshotData.assignments);
        if (!slots.success) throw new AgentError('INVALID_SNAPSHOT_ASSIGNMENTS');
        assignments = slots.data.map((slot, index) => ({
          ...slot, id: `${snapshot.id}:slot:${index}`, snapshotId: snapshot.id,
          status: 'accepted', offeredAt: snapshot.createdAt, metrics: emptyPlanMetrics(),
        }));
      } else {
        const ids = z.array(z.string()).safeParse(snapshot.snapshotData.assignmentIds);
        if (!ids.success) throw new AgentError('INVALID_SNAPSHOT_ASSIGNMENTS');
        const byId = new Map(rows.map((row) => [row.id, row]));
        assignments = ids.data.map((id) => {
          const row = byId.get(id);
          if (!row) throw new AgentError('SNAPSHOT_ASSIGNMENT_MISSING');
          return row;
        });
      }
      const notes = await db.siteMemories.getBySiteId(job.siteId);
      const latest = await db.boardSnapshots.getLatest();
      if (latest?.id !== snapshot.id) throw new AgentError('STALE_SNAPSHOT');
      return structuredClone({
        event,
        schedule: { date, snapshotId: snapshot.id, snapshotVersion: snapshot.version,
          technicians, jobs, assignments, travel },
        untrusted: { event_raw: event.rawText, job_note_raw: job.noteRaw,
          site_memory_raw: notes.map((note) => note.noteRaw) },
      });
    },
    async propose(input) {
      const raw = await scheduler.propose(structuredClone(input));
      const output = proposeOutputSchema.safeParse(raw);
      if (!output.success) throw new AgentError('INVALID_SCHEDULER_RESULT');
      if (output.data.engine === 'stub' || output.data.message === 'not_implemented') {
        throw new AgentError('SCHEDULER_NOT_IMPLEMENTED');
      }
      return output.data;
    },
    async validate(plan, schedule) {
      const result = await scheduler.validate(structuredClone(plan), structuredClone(schedule));
      const validation = planValidationSchema.safeParse(result);
      if (!validation.success) throw new AgentError('INVALID_VALIDATOR_RESULT');
      return validation.data;
    },
  };
}
