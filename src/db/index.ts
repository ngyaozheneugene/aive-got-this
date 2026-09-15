// Dispatch Coordinator v1.1
// Memory adapter for tests and the demo; Postgres when USE_MEMORY_DB=false.

import { IDatabase } from './interface';
import { InMemoryDatabase } from './memory';
import { PostgresDatabase } from './postgres';

export * from './interface';
export * from './memory';
export * from './postgres';

// The instance lives on globalThis, not in a module variable.
//
// Next.js compiles each route handler into its own bundle, so a module-level
// `let` is instantiated once PER ROUTE. With the in-memory adapter that gave
// every endpoint its own private database: an event created by POST /api/events
// was invisible to POST /api/events/{id}/plan, and each route's id counter
// restarted at 1. globalThis is shared across those bundles, and it also
// survives dev-server hot reloads.
const globalForDb = globalThis as unknown as { __dispatchDb?: IDatabase };

export function getDatabase(): IDatabase {
  if (!globalForDb.__dispatchDb) {
    const useMemory =
      process.env.NODE_ENV === 'test' || process.env.USE_MEMORY_DB !== 'false';
    globalForDb.__dispatchDb = useMemory
      ? new InMemoryDatabase()
      : (new PostgresDatabase() as IDatabase);
  }
  return globalForDb.__dispatchDb;
}
