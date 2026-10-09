import { z } from 'zod';

export const deskBoardSchema = z.object({
  date: z.string(),
  snapshot: z.object({
    id: z.string(),
    version: z.number(),
    snapshotData: z.record(z.unknown()),
    createdAt: z.string(),
  }),
  technicians: z.array(z.record(z.unknown())),
  jobs: z.array(z.record(z.unknown())),
  workingDay: z.object({ start: z.string(), end: z.string() }).optional(),
  cancelled: z.array(z.record(z.unknown())).optional(),
});
