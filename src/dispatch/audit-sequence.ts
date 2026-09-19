// The audit trail is one numbered story per event, written by two streams.
//
// The agent numbers its own tool steps 1..n as it goes. The desk decision and
// the commit are written later, by this stream, and used to leave `sequence`
// unset. `listByEvent` sorts `sequence ASC NULLS LAST, created_at ASC`, so the
// order still came out right, but only because the unnumbered entries happened
// to be the last ones. Anything else writing an unnumbered entry earlier would
// have reordered the trail, and the trace drawer showed 1..7 followed by two
// blanks.
//
// Continuing the numbering is not a nicety: the sequence is what makes the
// trail defensible when someone asks in what order the system did things.

import type { IDatabase } from '../db/interface';

export async function nextSequence(db: IDatabase, eventId: string): Promise<number> {
  const entries = await db.decisionLogs.listByEvent(eventId);
  return entries.reduce((highest, entry) => Math.max(highest, entry.sequence ?? 0), 0) + 1;
}
