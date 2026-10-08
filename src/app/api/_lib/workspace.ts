import { isWorkspace, type Workspace } from '../../../db/workspace';

/** Header the desk sends to choose a workspace. Absent or unknown: the company's own. */
export const WORKSPACE_HEADER = 'x-workspace';

export function workspaceOf(request: Request): Workspace {
  const value = request.headers.get(WORKSPACE_HEADER);
  return isWorkspace(value) ? value : 'live';
}
