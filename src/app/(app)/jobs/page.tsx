'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2, Plus, Search, Upload } from 'lucide-react';
import type { DeskBoard, DeskJobRow } from '../../../shared/types/domain';
import { addDays } from '../../../shared/config/demo';
import { CLUSTER_LABEL } from '../../../location/postal';
import { DeskApiError, deskApi } from '../../_components/desk-api';
import { JobImportView } from '../../_components/JobImportView';
import { NewJobForm, type BookableType } from '../../_components/NewJobForm';
import { FIELD } from '../../_components/TechnicianForm';
import { PageHeader } from '../../_components/shell/PageHeader';
import { hrefIn, useWorkspace } from '../../_components/shell/workspace';
import { Button } from '../../_components/ui/button';
import { Card } from '../../_components/ui/card';
import { cn } from '../../_components/lib/utils';

type Stage = 'waiting' | 'assigned' | 'underway' | 'done';
const STAGE: Record<Stage, { label: string; className: string }> = {
  waiting: { label: 'Waiting for a technician', className: 'text-destructive' },
  assigned: { label: 'Assigned', className: 'text-foreground' },
  underway: { label: 'Under way', className: 'text-sky-400' },
  done: { label: 'Done', className: 'text-success' },
};
const FILTERS: Array<{ key: Stage | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'underway', label: 'Under way' },
  { key: 'done', label: 'Done' },
];
const PRIORITY: Record<string, string> = { urgent: 'Urgent', on_demand: 'On demand', when_available: 'When available' };

/** Where a job is in its day, from its assignment and status. */
function stageOf(row: DeskJobRow): Stage {
  if (row.job.status === 'done') return 'done';
  if (!row.assignment) return 'waiting';
  return row.job.status === 'en_route' || row.job.status === 'on_site' ? 'underway' : 'assigned';
}

const time = (iso?: string) => iso?.slice(11, 16) ?? '–';

/**
 * Every job booked for the board's day and the next: who it is for, where,
 * when, and who has it. Booking and importing happen here; placing a waiting
 * job is the board's work (Find a technician), so waiting rows link there.
 */
export default function JobsPage() {
  const { workspace, simulation } = useWorkspace();
  const [board, setBoard] = useState<DeskBoard | null>(null);
  const [day, setDay] = useState<string | undefined>(undefined);
  const [types, setTypes] = useState<BookableType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<'import' | 'new' | null>(null);
  const [filter, setFilter] = useState<Stage | 'all'>('all');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      setBoard(await deskApi.getBoard(day));
      setError(null);
    } catch (e) {
      setError(e instanceof DeskApiError ? e.message : 'Could not load the jobs.');
    }
  }, [day]);

  useEffect(() => {
    void load();
  }, [load]);
  // Another desk may have booked or placed something: look again on coming back to the tab.
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);
  const loadTypes = useCallback(() => deskApi.jobTypes(), []);
  useEffect(() => {
    void loadTypes().then(setTypes, () => setTypes([]));
  }, [loadTypes]);

  const typeName = useMemo(() => new Map(types.map((t) => [t.id, t.name])), [types]);
  const today = board?.today ?? board?.date;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (board?.jobs ?? [])
      .filter((r) => filter === 'all' || stageOf(r) === filter)
      .filter((r) =>
        !q ||
        [r.customer.name, r.customer.phone, r.site.addressLine1, r.site.postalCode, r.technician?.name, typeName.get(r.job.jobTypeId)]
          .some((v) => v?.toLowerCase().includes(q)),
      )
      .sort((a, b) => (a.job.windowStart ?? '').localeCompare(b.job.windowStart ?? '') || a.customer.name.localeCompare(b.customer.name));
  }, [board, filter, query, typeName]);
  const counts = useMemo(() => {
    const c: Record<Stage, number> = { waiting: 0, assigned: 0, underway: 0, done: 0 };
    for (const r of board?.jobs ?? []) c[stageOf(r)] += 1;
    return c;
  }, [board]);

  const closePanel = async () => {
    setPanel(null);
    await load();
  };

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Jobs"
        description={
          board
            ? `${board.jobs.length} booked for ${board.date === today ? 'today' : 'tomorrow'}${counts.waiting ? ` · ${counts.waiting} waiting for a technician` : ''}${simulation ? ' · sample day' : ''}`
            : 'Everything booked for today and tomorrow.'
        }
        actions={
          <>
            <Button size="sm" variant={panel === 'import' ? 'secondary' : 'outline'} onClick={() => setPanel(panel === 'import' ? null : 'import')}>
              <Upload />
              Import jobs
            </Button>
            <Button size="sm" onClick={() => setPanel(panel === 'new' ? null : 'new')} disabled={panel === 'new'}>
              <Plus />
              New job
            </Button>
          </>
        }
      />

      <div className="grid gap-4 p-4 sm:p-6">
        {panel === 'import' ? (
          <Card className="overflow-hidden p-0">
            <JobImportView onCancel={() => setPanel(null)} onImported={() => void closePanel()} />
          </Card>
        ) : null}
        {panel === 'new' ? (
          <Card className="max-w-md p-0">
            <NewJobForm
              loadTypes={loadTypes}
              submitLabel="Book"
              onCancel={() => setPanel(null)}
              onBook={async (body) => {
                try {
                  await deskApi.createJob(body);
                  await closePanel();
                  return null;
                } catch (e) {
                  return e instanceof DeskApiError ? (e.detail ?? e.code) : 'Could not book the job.';
                }
              }}
            />
          </Card>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {today ? (
            <span role="group" aria-label="Day" className="flex rounded-md border p-0.5 text-[12.5px]">
              {[today, addDays(today, 1)].map((d, i) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={board?.date === d}
                  onClick={() => setDay(i === 0 ? undefined : d)}
                  className={cn('rounded px-2.5 py-1 font-medium', board?.date === d ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}
                >
                  {i === 0 ? 'Today' : 'Tomorrow'}
                </button>
              ))}
            </span>
          ) : null}
          <span role="group" aria-label="Show" className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[12px]',
                  filter === f.key ? 'border-primary/50 bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {f.label}
                {f.key !== 'all' && counts[f.key] ? <span className="ml-1 text-muted-foreground">{counts[f.key]}</span> : null}
              </button>
            ))}
          </span>
          <label className="relative ml-auto block w-full max-w-xs">
            <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
            <input className={cn(FIELD, 'pl-8')} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Customer, address, phone, technician" aria-label="Find a job" />
          </label>
        </div>

        {error ? <p role="alert" className="text-[13px] text-destructive">{error}</p> : null}
        {!board ? (
          <p className="flex items-center gap-2 py-8 text-[13px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading the jobs…
          </p>
        ) : board.jobs.length === 0 ? (
          <Card className="grid gap-3 p-6">
            <h2 className="text-base font-semibold">No jobs booked for {board.date === today ? 'today' : 'tomorrow'}</h2>
            <p className="text-[13px] text-muted-foreground">
              Book one with New job, or import a list of work orders from a spreadsheet. Booked jobs wait here until a technician is found on the board.
            </p>
          </Card>
        ) : (
          <Card className="gap-0 overflow-hidden py-0">
            <div className="hidden grid-cols-[96px_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 border-b bg-muted/30 px-4 py-2 text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase md:grid">
              <span>Window</span>
              <span>Customer</span>
              <span>Where</span>
              <span>Job</span>
              <span>Technician</span>
            </div>
            <ul>
              {rows.map((r) => {
                const stage = stageOf(r);
                return (
                  <li
                    key={r.job.id}
                    className="grid grid-cols-1 gap-x-4 gap-y-1 border-b px-4 py-3 text-[13px] last:border-b-0 md:grid-cols-[96px_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]"
                  >
                    <span className="font-mono text-[12.5px]">
                      {time(r.job.windowStart)}–{time(r.job.windowEnd)}
                      {r.assignment ? <span className="block text-[11px] text-muted-foreground">at {time(r.assignment.windowStart)}</span> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{r.customer.name}</span>
                      <span className="block text-[12px] text-muted-foreground">{r.customer.phone}</span>
                    </span>
                    <span className="min-w-0 text-[12.5px]">
                      <span className="block truncate">
                        {r.site.addressLine1}
                        {r.site.unitNo ? ` ${r.site.unitNo}` : ''}
                      </span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {r.site.postalCode} · {CLUSTER_LABEL[r.site.estateCluster as keyof typeof CLUSTER_LABEL] ?? r.site.estateCluster}
                      </span>
                    </span>
                    <span className="min-w-0 text-[12.5px]">
                      <span className="block truncate">{typeName.get(r.job.jobTypeId) ?? r.job.jobTypeId}</span>
                      <span className={cn('block text-[12px]', r.job.priority === 'urgent' ? 'text-warning' : 'text-muted-foreground')}>
                        {PRIORITY[r.job.priority] ?? r.job.priority}
                      </span>
                    </span>
                    <span className="min-w-0 text-[12.5px]">
                      {r.technician ? <span className="block truncate font-medium">{r.technician.name}</span> : null}
                      <span className={cn('block text-[12px]', STAGE[stage].className)}>{STAGE[stage].label}</span>
                      {stage === 'waiting' && board.date === today ? (
                        <Link href={hrefIn('/desk', workspace)} className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-primary hover:underline">
                          Find a technician on the board <ArrowRight className="size-3" />
                        </Link>
                      ) : null}
                    </span>
                    {r.job.noteRaw ? <span className="truncate text-[12px] text-muted-foreground md:col-span-4 md:col-start-2" title={r.job.noteRaw}>“{r.job.noteRaw}”</span> : null}
                  </li>
                );
              })}
              {rows.length === 0 ? <li className="px-4 py-6 text-[13px] text-muted-foreground">No jobs match.</li> : null}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
