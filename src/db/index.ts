// Dispatch Coordinator v1.1
// Memory adapter for tests and the demo; Postgres when USE_MEMORY_DB=false.

import { IDatabase } from './interface';
import { InMemoryDatabase } from './memory';
import { PostgresDatabase } from './postgres';
import { isIsoDate, singaporeToday } from '../shared/config/demo';
import { EASTWIND, type Scenario } from '../shared/fixtures/eastwind';
import { buildEmptyScenario, buildScenario } from '../shared/fixtures/scenario';
import type { Workspace } from './workspace';

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
const globalForDb = globalThis as unknown as { __dispatchDbs?: Partial<Record<Workspace, IDatabase>> };

export { isWorkspace, WORKSPACES, type Workspace } from './workspace';

/** One store per workspace (src/db/workspace.ts). On Postgres, one schema each. */

export function getDatabase(workspace: Workspace = 'live'): IDatabase {
  const dbs = (globalForDb.__dispatchDbs ??= {});
  if (!dbs[workspace]) {
    const useMemory =
      process.env.NODE_ENV === 'test' || process.env.USE_MEMORY_DB !== 'false';
    const scenario = workspaceScenario(workspace);
    // Postgres migrates and, on an empty schema, seeds itself on first use.
    dbs[workspace] = useMemory
      ? new InMemoryDatabase({ scenario })
      : new PostgresDatabase({ scenario, schema: workspace === 'live' ? 'live' : 'simulation' });
  }
  return dbs[workspace]!;
}

/** What each workspace starts from (and what a simulation reset restores). */
export function workspaceScenario(
  workspace: Workspace,
  env: Record<string, string | undefined> = process.env,
): () => Scenario {
  if (workspace === 'simulation') return simulationScenario(env);
  // Tests are written against Eastwind whichever workspace a route lands in.
  if (env.NODE_ENV === 'test') return () => EASTWIND;
  return () => buildEmptyScenario(singaporeToday());
}

/**
 * The sample day. Tests always get the fixed Eastwind fixture. Otherwise
 * `DEMO_SCENARIO=eastwind` keeps the 12-job board, and the default is the
 * finals board dated today in Singapore (or `BOARD_DATE`, for rehearsing a
 * specific day). Re-evaluated on every reset, so a reset re-dates the board.
 */
export function simulationScenario(env: Record<string, string | undefined> = process.env): () => Scenario {
  if (env.NODE_ENV === 'test' || env.DEMO_SCENARIO === 'eastwind') return () => EASTWIND;
  return () => buildScenario(isIsoDate(env.BOARD_DATE) ? env.BOARD_DATE : singaporeToday());
}
