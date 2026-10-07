// Dispatch Coordinator v1.1
// Memory adapter for tests and the demo; Postgres when USE_MEMORY_DB=false.

import { IDatabase } from './interface';
import { InMemoryDatabase } from './memory';
import { PostgresDatabase } from './postgres';
import { isIsoDate, singaporeToday } from '../shared/config/demo';
import { EASTWIND, type Scenario } from '../shared/fixtures/eastwind';
import { buildScenario } from '../shared/fixtures/scenario';

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
      ? new InMemoryDatabase({ scenario: liveScenario() })
      : (new PostgresDatabase() as IDatabase);
  }
  return globalForDb.__dispatchDb;
}

/**
 * The seed the running app uses. Tests always get the fixed Eastwind fixture.
 * Otherwise `DEMO_SCENARIO=eastwind` keeps the 12-job board, and the default is
 * the finals board dated today in Singapore (or `BOARD_DATE`, for rehearsing a
 * specific day). Re-evaluated on every reset, so a reset re-dates the board.
 */
export function liveScenario(env: Record<string, string | undefined> = process.env): () => Scenario {
  if (env.NODE_ENV === 'test' || env.DEMO_SCENARIO === 'eastwind') return () => EASTWIND;
  return () => buildScenario(isIsoDate(env.BOARD_DATE) ? env.BOARD_DATE : singaporeToday());
}
