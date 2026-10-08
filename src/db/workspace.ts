// The two workspaces. Kept apart from src/db/index.ts so code that only needs
// the name (the routes' header parsing) does not pull in the adapters.

/**
 * `live` is the company's own: it starts empty and follows the calendar.
 * `simulation` holds the sample day and is the only one a reset may touch.
 */
export type Workspace = 'live' | 'simulation';
export const WORKSPACES: readonly Workspace[] = ['live', 'simulation'];

export function isWorkspace(value: unknown): value is Workspace {
  return value === 'live' || value === 'simulation';
}
