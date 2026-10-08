'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ClipboardList, FlaskConical, Map as MapIcon, PanelLeftClose, PanelLeftOpen, Settings, Snowflake, Users } from 'lucide-react';
import { cn } from '../lib/utils';
import { hrefIn, useWorkspace, WorkspaceProvider } from './workspace';

const NAV = [
  { href: '/desk', label: 'Dispatch', icon: MapIcon },
  { href: '/jobs', label: 'Jobs', icon: ClipboardList },
  { href: '/team', label: 'Team', icon: Users },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

const COLLAPSED_KEY = 'shell:collapsed';

/** The tool's frame: navigation on the left, the page on the right. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-background">
      <WorkspaceProvider>
        <div className="flex h-full">
          <Sidebar />
          <main className="relative min-w-0 flex-1 overflow-y-auto">{children}</main>
        </div>
      </WorkspaceProvider>
    </div>
  );
}

function Sidebar() {
  const pathname = usePathname();
  const { workspace, simulation, settings, switchWorkspace } = useWorkspace();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1');
    } catch {
      // Expanded by default.
    }
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1');
      } catch {
        // Not remembered; still toggles.
      }
      return !c;
    });
  };
  // Narrow screens always get the icon rail.
  const wide = !collapsed;

  return (
    <nav
      aria-label="Main"
      className={cn(
        'z-[900] flex flex-none flex-col border-r bg-card/60 transition-[width] duration-200',
        'w-[56px]',
        wide && 'md:w-[216px]',
      )}
    >
      <div className={cn('flex h-12 items-center gap-2.5 border-b px-3', wide && 'md:px-3.5')}>
        <div className="grid size-7 flex-none place-items-center rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-[0_0_18px_-4px] shadow-blue-500/70">
          <Snowflake className="size-4" />
        </div>
        <span className={cn('hidden min-w-0 flex-col leading-tight', wide && 'md:flex')}>
          <span className="truncate text-[13px] font-semibold">{settings.name}</span>
          <span className="truncate text-[11px] text-muted-foreground">Dispatch Coordinator</span>
        </span>
      </div>

      <ul className="grid gap-0.5 p-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={hrefIn(href, workspace)}
                aria-current={active ? 'page' : undefined}
                title={label}
                className={cn(
                  'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                  'outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                  active && 'bg-primary/15 font-medium text-foreground',
                )}
              >
                <Icon className="size-[18px] flex-none" />
                <span className={cn('hidden truncate', wide && 'md:inline')}>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto grid gap-2 p-2">
        <div
          className={cn(
            'grid gap-2',
            wide && 'md:rounded-lg md:border md:p-2',
            wide && (simulation ? 'md:border-warning/30 md:bg-warning/5' : 'md:bg-background/40'),
          )}
        >
          <span className={cn('hidden min-w-0 flex-col', wide && 'md:flex')}>
            <span className={cn('flex items-center gap-1.5 text-[12px] font-semibold', simulation && 'text-warning')}>
              {simulation ? <FlaskConical className="size-3.5" /> : null}
              {simulation ? 'Simulation' : 'Your workspace'}
            </span>
            <span className="text-[11px] leading-snug text-muted-foreground">
              {simulation ? 'A sample company and day. Nothing here touches your workspace.' : 'Your own team, jobs and settings.'}
            </span>
          </span>
          <button
            type="button"
            onClick={() => switchWorkspace(simulation ? 'live' : 'simulation')}
            title={simulation ? 'Exit simulation' : 'Try a sample day'}
            aria-label={simulation ? 'Exit simulation' : 'Try a sample day'}
            className={cn(
              'flex h-9 items-center justify-center gap-1.5 rounded-lg border text-[12px] font-medium transition-colors hover:bg-accent',
              simulation && 'border-warning/40 bg-warning/10',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
            )}
          >
            <FlaskConical className={cn('size-3.5', !simulation && 'text-warning')} />
            <span className={cn('hidden', wide && 'md:inline')}>{simulation ? 'Exit simulation' : 'Try a sample day'}</span>
          </button>
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
          title={collapsed ? 'Expand' : 'Collapse'}
          className="hidden h-8 items-center gap-2 rounded-md px-2.5 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground md:flex"
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          <span className={cn('hidden', wide && 'md:inline')}>Collapse</span>
        </button>
      </div>
    </nav>
  );
}
