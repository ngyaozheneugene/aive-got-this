'use client';

import { Fragment, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { deskApi, setDeskWorkspace, type CompanySettings, type DeskWorkspace } from '../desk-api';

interface WorkspaceState {
  workspace: DeskWorkspace;
  simulation: boolean;
  settings: CompanySettings;
  /** Into or out of the sample day. Every page below remounts, so nothing in flight carries across. */
  switchWorkspace: (next: DeskWorkspace) => void;
  /** After the settings page saves. */
  reloadSettings: () => Promise<void>;
}

const Ctx = createContext<WorkspaceState | null>(null);

export function useWorkspace(): WorkspaceState {
  const state = useContext(Ctx);
  if (!state) throw new Error('useWorkspace outside WorkspaceProvider');
  return state;
}

const STORAGE_KEY = 'desk:workspace';

/** Href for a page in the current workspace: the sample day travels in the URL. */
export function hrefIn(path: string, workspace: DeskWorkspace): string {
  return workspace === 'simulation' ? `${path}?mode=simulation` : path;
}

function initialWorkspace(): DeskWorkspace {
  const mode = new URLSearchParams(window.location.search).get('mode');
  if (mode === 'simulation') return 'simulation';
  if (mode === 'live') return 'live';
  try {
    return localStorage.getItem(STORAGE_KEY) === 'simulation' ? 'simulation' : 'live';
  } catch {
    return 'live';
  }
}

function syncUrl(workspace: DeskWorkspace) {
  const url = new URL(window.location.href);
  if (workspace === 'simulation') url.searchParams.set('mode', 'simulation');
  else url.searchParams.delete('mode');
  window.history.replaceState(window.history.state, '', url);
}

/**
 * Which workspace every page is looking at, and that workspace's company
 * settings. Pages render only once both are known, so no request goes to
 * the wrong workspace.
 */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspace, setWorkspace] = useState<DeskWorkspace | null>(null);
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async (next: DeskWorkspace) => {
    setDeskWorkspace(next);
    setError(false);
    try {
      const loaded = await deskApi.settings();
      setSettings(loaded);
      setWorkspace(next);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load(initialWorkspace());
  }, [load]);

  const switchWorkspace = useCallback(
    (next: DeskWorkspace) => {
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Best effort: the URL still carries the choice.
      }
      syncUrl(next);
      void load(next);
    },
    [load],
  );

  const reloadSettings = useCallback(async () => {
    setSettings(await deskApi.settings());
  }, []);

  if (error) {
    return (
      <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">
        <span>
          Could not reach the server.{' '}
          <button type="button" className="text-foreground underline" onClick={() => void load(workspace ?? initialWorkspace())}>
            Retry
          </button>
        </span>
      </div>
    );
  }

  if (!workspace || !settings) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" />
          Loading…
        </span>
      </div>
    );
  }

  return (
    <Ctx.Provider value={{ workspace, simulation: workspace === 'simulation', settings, switchWorkspace, reloadSettings }}>
      <Fragment key={workspace}>{children}</Fragment>
    </Ctx.Provider>
  );
}
