// The two methods the commit path needs from the data layer, proven against the
// adapter the app actually runs on today.

import { describe, expect, it } from 'vitest';
import { InMemoryDatabase } from './index';
import { getCurrentBoard } from '../../dispatch/current-board';

describe('decisionLogs.listByEvent', () => {
  it('returns only this event, oldest first', async () => {
    const db = new InMemoryDatabase();
    const base = { eventType: 'urgent_job', playbook: 'urgent', toolCalls: [] };

    await db.decisionLogs.create({
      ...base,
      eventId: 'opev_1',
      sequence: 2,
      summary: 'second',
    });
    await db.decisionLogs.create({
      ...base,
      eventId: 'opev_1',
      sequence: 1,
      summary: 'first',
    });
    await db.decisionLogs.create({
      ...base,
      eventId: 'opev_other',
      sequence: 1,
      summary: 'different event',
    });

    const entries = await db.decisionLogs.listByEvent('opev_1');
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.eventId === 'opev_1')).toBe(true);
    // Written second-then-first; `sequence` decides, not insertion or timestamp.
    expect(entries.map((e) => e.summary)).toEqual(['first', 'second']);
    expect(entries.map((e) => e.sequence)).toEqual([1, 2]);
  });

  it('returns an empty list for an event with no trail', async () => {
    const db = new InMemoryDatabase();
    await expect(db.decisionLogs.listByEvent('opev_unknown')).resolves.toEqual([]);
  });
});

describe('assignments.supersede', () => {
  it('takes the job off the board without deleting the row', async () => {
    const db = new InMemoryDatabase();

    const before = await getCurrentBoard(db);
    const weiBefore = before.technicians.find((t) => t.technician.id === 'tech_wei');
    const assignedJobId = weiBefore?.assignedJobIds[0];
    expect(assignedJobId).toBeDefined();
    const loadBefore = weiBefore?.loadMinutes ?? 0;
    expect(loadBefore).toBeGreaterThan(0);

    const assignments = await db.assignments.getByJobId(assignedJobId!);
    const live = assignments.find((a) => a.status === 'accepted' || a.status === 'offered');
    expect(live).toBeDefined();

    const superseded = await db.assignments.supersede(live!.id, 'reassigned');
    expect(superseded.status).toBe('reassigned');

    const after = await getCurrentBoard(db);
    const weiAfter = after.technicians.find((t) => t.technician.id === 'tech_wei');
    expect(weiAfter?.assignedJobIds).not.toContain(assignedJobId);
    expect(weiAfter?.loadMinutes).toBeLessThan(loadBefore);

    // The row survives for the audit trail; only its status changed.
    await expect(db.assignments.getById(live!.id)).resolves.toMatchObject({
      id: live!.id,
      status: 'reassigned',
    });

    // And the job no longer shows a technician on the desk.
    const jobRow = after.jobs.find((j) => j.job.id === assignedJobId);
    expect(jobRow?.technician).toBeUndefined();
  });

  it('throws rather than silently doing nothing for an unknown assignment', async () => {
    const db = new InMemoryDatabase();
    await expect(db.assignments.supersede('asg_nope', 'cancelled')).rejects.toThrow();
  });
});
