import type { IDatabase } from '../../db/interface';
import { buildBoardSchedule } from '../../dispatch/board-schedule';
import type { PlanningSchedule } from '../../dispatch/board-schedule';
import { propose, proposeWithSidecar } from '../../matching/propose';
import { validatePlan } from '../../matching/validate';
import {
  jobCancelledPayloadSchema, jobOverrunPayloadSchema, operationalEventSchema, placeWaitingPayloadSchema, technicianUnavailablePayloadSchema,
  unavailabilityIssue, urgentJobPayloadSchema,
} from '../../shared/contracts/events';
import { applyDisruption, parseUnavailability, unavailabilityOnDay } from '../../matching/disruption';
import { planValidationSchema } from '../../shared/contracts/propose';
import type {
  BoardSchedule, CandidatePlan, OperationalEvent, PlanValidation, ProposeInput, ProposeOutput,
} from '../../shared/types/domain';
import { AgentError } from '../runtime/errors';
import { selectRequestedProfile } from './scheduler-profile';

export interface PlanningContext {
  event: OperationalEvent;
  schedule: PlanningSchedule;
  untrusted: { event_raw: string; job_note_raw: string; site_memory_raw: string[] };
}
export interface SchedulerPort {
  propose(input: ProposeInput): ProposeOutput | Promise<ProposeOutput>;
  proposeWithSidecar?(input: ProposeInput): ProposeOutput | Promise<ProposeOutput>;
  validate(plan: CandidatePlan, schedule: BoardSchedule): PlanValidation | Promise<PlanValidation>;
}
export interface UrgentTools extends SchedulerPort {
  readContext(eventId: string, sourceSnapshotId?: string): Promise<PlanningContext>;
}

function primaryId(event: OperationalEvent): { jobId?: string; technicianId?: string; jobIds?: string[] } {
  if (event.type === 'job_cancelled') {
    const payload = jobCancelledPayloadSchema.strict().safeParse(event.normalizedPayload);
    if (!payload.success) throw new AgentError('INVALID_EVENT_PAYLOAD');
    return { jobId: payload.data.jobId };
  }
  if (event.type === 'place_waiting') {
    const payload = placeWaitingPayloadSchema.strict().safeParse(event.normalizedPayload);
    if (!payload.success) throw new AgentError('INVALID_EVENT_PAYLOAD');
    return { jobIds: payload.data.jobIds };
  }
  if (event.type === 'urgent_job') {
    const payload = urgentJobPayloadSchema.strict().safeParse(event.normalizedPayload);
    if (!payload.success) throw new AgentError('INVALID_EVENT_PAYLOAD');
    return { jobId: payload.data.jobId };
  }
  if (event.type === 'technician_unavailable') {
    const payload = technicianUnavailablePayloadSchema.strict().safeParse(event.normalizedPayload);
    if (!payload.success) throw new AgentError('INVALID_EVENT_PAYLOAD');
    return { technicianId: payload.data.technicianId };
  }
  if (event.type === 'job_overrun') {
    const payload = jobOverrunPayloadSchema.strict().safeParse(event.normalizedPayload);
    if (!payload.success) throw new AgentError('INVALID_EVENT_PAYLOAD');
    return { jobId: payload.data.jobId };
  }
  throw new AgentError('UNSUPPORTED_EVENT_TYPE');
}

/** Sidecar is optional on the port; a missing named export must not throw at construction. */
function matchingSidecar(): SchedulerPort['proposeWithSidecar'] {
  try {
    return typeof proposeWithSidecar === 'function' ? proposeWithSidecar : undefined;
  } catch {
    return undefined;
  }
}

/** Read-only tools. Share platform's live rows, certs, shifts and requirements. */
export function createUrgentTools(
  db: IDatabase,
  scheduler: SchedulerPort = { propose, validate: validatePlan, proposeWithSidecar: matchingSidecar() },
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
      if (!['RECEIVED', 'VALIDATED', 'PLANNING'].includes(event.status) || event.validationIssues.length) {
        throw new AgentError('EVENT_NOT_PLANNABLE');
      }
      const ids = primaryId(event);
      if (event.type === 'urgent_job' && event.affectedIds.some((id) => id !== ids.jobId)) {
        throw new AgentError('EVENT_AFFECTED_IDS_MISMATCH');
      }
      if (event.type === 'place_waiting' &&
          (event.affectedIds.length !== ids.jobIds!.length || event.affectedIds.some((id) => !ids.jobIds!.includes(id)))) {
        throw new AgentError('EVENT_AFFECTED_IDS_MISMATCH');
      }
      if (event.type !== 'urgent_job' && ids.technicianId && event.affectedIds.length &&
          !event.affectedIds.includes(ids.technicianId)) {
        throw new AgentError('EVENT_AFFECTED_IDS_MISMATCH');
      }
      if (event.type === 'job_cancelled' && event.affectedIds.some((id) => id !== ids.jobId)) {
        throw new AgentError('EVENT_AFFECTED_IDS_MISMATCH');
      }
      if (event.type === 'job_overrun' && ids.jobId && event.affectedIds.length &&
          !event.affectedIds.includes(ids.jobId)) {
        throw new AgentError('EVENT_AFFECTED_IDS_MISMATCH');
      }
      if ((expectedSnapshotId && snapshot.id !== expectedSnapshotId) ||
          (event.sourceSnapshotId && snapshot.id !== event.sourceSnapshotId)) throw new AgentError('STALE_SNAPSHOT');
      const board = await buildBoardSchedule(db);
      if (board.snapshotId !== snapshot.id) throw new AgentError('STALE_SNAPSHOT');
      const unavailability = parseUnavailability(event);
      if (unavailability && (unavailabilityIssue(unavailability) || !unavailabilityOnDay(unavailability, board.date))) {
        throw new AgentError('INVALID_EVENT_PAYLOAD');
      }
      // Cancelling: the job must be on today's board and not yet started. Work
      // under way is the technician's to finish, not something to cancel.
      if (event.type === 'job_cancelled') {
        const target = board.jobs.find((row) => row.id === ids.jobId);
        if (!target) throw new AgentError('EVENT_JOB_NOT_FOUND_ON_BOARD');
        if (['en_route', 'on_site', 'done'].includes(target.status) || target.lockState === 'in_progress') {
          throw new AgentError('JOB_ALREADY_STARTED');
        }
      }
      // The board once the event has happened: both engines and the validator plan on this.
      const schedule = applyDisruption(board, event);
      const job = ids.jobId && event.type !== 'job_cancelled' ? schedule.jobs.find((row) => row.id === ids.jobId) : undefined;
      if (ids.jobId && !job && event.type !== 'job_cancelled') throw new AgentError('EVENT_JOB_NOT_FOUND_ON_BOARD');
      // "Find a technician" for a job that already has one is not a request to
      // plan: the fallback would quietly hand the job to someone else.
      if (event.type === 'urgent_job' && schedule.assignments.some((a) => a.jobId === ids.jobId)) {
        throw new AgentError('JOB_ALREADY_ASSIGNED');
      }
      // Placing waiting jobs: every one must be on today's board and still waiting.
      // One that was placed or removed since the request means the request is stale.
      if (ids.jobIds) {
        const booked = new Set(schedule.assignments.map((a) => a.jobId));
        for (const id of ids.jobIds) {
          if (!schedule.jobs.some((row) => row.id === id)) throw new AgentError('EVENT_JOB_NOT_FOUND_ON_BOARD');
          if (booked.has(id)) throw new AgentError('PLANNING_CONTEXT_CHANGED');
        }
      }
      if (ids.technicianId && !schedule.technicians.some((row) => row.id === ids.technicianId)) {
        throw new AgentError('INVALID_EVENT_PAYLOAD');
      }
      const notes = job ? await db.siteMemories.getBySiteId(job.siteId) : [];
      const latest = await db.boardSnapshots.getLatest();
      if (latest?.id !== snapshot.id) throw new AgentError('STALE_SNAPSHOT');
      return structuredClone({
        event, schedule,
        untrusted: { event_raw: event.rawText, job_note_raw: job?.noteRaw ?? '',
          site_memory_raw: notes.map((note) => note.noteRaw) },
      });
    },
    async propose(input) {
      const sidecar = scheduler.proposeWithSidecar;
      // Every event goes to the solver, urgent jobs included, so a new request
      // can rebalance the day around it. Insertion answers when it cannot.
      const useSidecar = typeof sidecar === 'function';
      const raw = await (useSidecar ? sidecar(structuredClone(input)) : scheduler.propose(structuredClone(input)));
      return selectRequestedProfile(input, raw);
    },
    async validate(plan, schedule) {
      const result = await scheduler.validate(structuredClone(plan), structuredClone(schedule));
      const validation = planValidationSchema.safeParse(result);
      if (!validation.success) throw new AgentError('INVALID_VALIDATOR_RESULT');
      return validation.data;
    },
  };
}
