'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FlaskConical, Loader2, Pencil, Plus, Search, Upload, UserCheck, UserX } from 'lucide-react';
import { deskApi, type TeamMember } from '../../_components/desk-api';
import { FIELD, FOCUS, TechnicianForm } from '../../_components/TechnicianForm';
import { PageHeader } from '../../_components/shell/PageHeader';
import { useWorkspace } from '../../_components/shell/workspace';
import { Button } from '../../_components/ui/button';
import { Card } from '../../_components/ui/card';
import { CLUSTER_LABEL } from '../../../location/postal';
import { LEGAL_GATE_CERTS } from '../../../shared/contracts/technicians';
import { RosterImportView } from '../../_components/RosterImportView';
import { cn } from '../../_components/lib/utils';

/**
 * Who works here, what they are certified for, what they carry and where their
 * day starts. Eligibility reads these directly, so a change is in force at the
 * next plan.
 */
export default function TeamPage() {
  const { settings, simulation, switchWorkspace } = useWorkspace();
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [editing, setEditing] = useState<TeamMember | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // On narrow screens the editor sits below the list; bring it into view.
  const editorRef = useRef<HTMLElement>(null);
  const editingKey = editing === 'new' ? 'new' : editing?.id;
  useEffect(() => {
    if (editingKey) editorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [editingKey]);

  const reload = useCallback(async () => {
    try {
      setTeam(await deskApi.team());
    } catch {
      setError('Could not load the team.');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saved = async () => {
    setEditing(null);
    await reload();
  };

  const toggleActive = async (t: TeamMember) => {
    try {
      await deskApi.updateTechnician(t.id, { isActive: !t.isActive });
      await reload();
    } catch {
      setError(`Could not update ${t.name}.`);
    }
  };

  const q = query.trim().toLowerCase();
  const matches = (team ?? []).filter(
    (t) =>
      !q ||
      t.name.toLowerCase().includes(q) ||
      t.certs.some((c) => String(c.certType).toLowerCase().includes(q)) ||
      (t.parts ?? []).some((p) => p.includes(q.replace(/\s+/g, '_'))),
  );
  const active = matches.filter((t) => t.isActive);
  const inactive = matches.filter((t) => !t.isActive);
  const activeCount = (team ?? []).filter((t) => t.isActive).length;
  const empty = team !== null && team.length === 0;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Team"
        description={team ? `${activeCount} active${simulation ? ' · sample team' : ''}. New people work every day from ${settings.dayStart}.` : 'Your technicians.'}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={importing ? 'secondary' : 'outline'}
              onClick={() => {
                setEditing(null);
                setImporting((v) => !v);
              }}
              className="gap-1.5"
            >
              <Upload className="size-3.5" />
              Import roster
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setImporting(false);
                setEditing('new');
              }}
              disabled={editing === 'new'}
              className="gap-1.5"
            >
              <Plus className="size-3.5" />
              Add technician
            </Button>
          </div>
        }
      />

      {importing ? (
        <div className="p-4 sm:p-6">
          <Card className="overflow-hidden border p-0 shadow-lg">
            <RosterImportView
              onCancel={() => setImporting(false)}
              onImported={async () => {
                setImporting(false);
                await reload();
              }}
            />
          </Card>
        </div>
      ) : (
        <div className={cn('grid gap-4 p-4 sm:p-6', editing && 'lg:grid-cols-[minmax(0,1fr)_400px]')}>
          <section aria-label="Technicians" className="grid min-w-0 content-start gap-3">
            {error ? <p role="alert" className="text-[13px] text-destructive">{error}</p> : null}
            {!team ? (
              <p className="flex items-center gap-2 py-8 text-[13px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading the team…
              </p>
            ) : empty && !editing ? (
              <Card className="grid gap-3 p-6">
                <h2 className="text-base font-semibold">Nobody on the team yet</h2>
                <p className="text-[13px] text-muted-foreground">
                  Add the technicians who work for you: their skill tier, certificates, the parts on their van and where their day
                  starts. Then book jobs on the dispatch board and let the assistant plan around whatever the day brings.
                </p>
                <span className="flex flex-wrap gap-2">
                  <Button onClick={() => setEditing('new')}>
                    <Plus />
                    Add your first technician
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setImporting(true)}
                    className="gap-1.5"
                  >
                    <Upload className="size-3.5" />
                    Import a roster file
                  </Button>
                  {!simulation ? (
                    <Button variant="outline" onClick={() => switchWorkspace('simulation')}>
                      <FlaskConical className="text-warning" />
                      Look at a sample team first
                    </Button>
                  ) : null}
                </span>
              </Card>
            ) : (
              <>
                {team.length > 0 ? (
                  <label className="relative block max-w-sm">
                  <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
                  <input
                    className={cn(FIELD, 'pl-8')}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Find by name, certificate or part"
                    aria-label="Find a technician"
                  />
                </label>
              ) : null}
              <Card className="gap-0 overflow-hidden py-0">
                <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,2fr)_auto] gap-4 border-b bg-muted/30 px-4 py-2 text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase md:grid">
                  <span>Technician</span>
                  <span>Day starts in</span>
                  <span>Certificates and parts</span>
                  <span className="w-16" />
                </div>
                <ul>
                  {[...active, ...inactive].map((t) => (
                    <li
                      key={t.id}
                      className={cn(
                        'grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1.5 border-b px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,2fr)_auto]',
                        !t.isActive && 'opacity-55',
                        editing !== 'new' && editing?.id === t.id && 'bg-primary/5',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-semibold">{t.name}</span>
                        <span className="block text-[12px] text-muted-foreground">
                          Tier {t.tier} · {t.maxMinutesDay / 60} h/day{t.acceptsOt ? ' · overtime ok' : ''}
                          {!t.isActive ? ' · off the team' : ''}
                        </span>
                      </span>
                      <span className="col-start-1 text-[12.5px] text-muted-foreground md:col-start-auto">
                        {t.currentCluster ? CLUSTER_LABEL[t.currentCluster as keyof typeof CLUSTER_LABEL] ?? t.currentCluster : t.homeRegion}
                      </span>
                      <span className="col-start-1 flex flex-wrap gap-1 md:col-start-auto">
                        {t.certs.length === 0 && (t.parts ?? []).length === 0 ? (
                          <span className="text-[12px] text-muted-foreground">None on file</span>
                        ) : null}
                        {t.certs.map((c) => (
                          <span
                            key={c.id}
                            className={cn(
                              'rounded border px-1.5 py-px text-[11px]',
                              LEGAL_GATE_CERTS.includes(String(c.certType)) ? 'border-primary/40 text-primary' : 'text-muted-foreground',
                            )}
                            title={c.expiresAt ? `Expires ${c.expiresAt}` : 'No expiry on file'}
                          >
                            {String(c.certType).replace('_', ' ')}
                            {c.expiresAt ? ` · ${c.expiresAt}` : ''}
                          </span>
                        ))}
                        {(t.parts ?? []).map((p) => (
                          <span key={p} className="rounded border border-dashed px-1.5 py-px text-[11px] text-muted-foreground">
                            carries {p.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </span>
                      <span className="col-start-2 row-start-1 flex gap-1 md:col-start-auto md:row-start-auto">
                        <button
                          type="button"
                          onClick={() => setEditing(t)}
                          aria-label={`Edit ${t.name}`}
                          title="Edit"
                          className={cn('grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground', FOCUS)}
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleActive(t)}
                          aria-label={t.isActive ? `Take ${t.name} off the team` : `Put ${t.name} back on the team`}
                          title={t.isActive ? 'Take off the team (keeps their history)' : 'Put back on the team'}
                          className={cn('grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground', FOCUS)}
                        >
                          {t.isActive ? <UserX className="size-4" /> : <UserCheck className="size-4" />}
                        </button>
                      </span>
                    </li>
                  ))}
                  {matches.length === 0 && team.length > 0 ? (
                    <li className="px-4 py-6 text-[13px] text-muted-foreground">Nobody matches “{query}”.</li>
                  ) : null}
                </ul>
              </Card>
            </>
          )}
        </section>

        {editing ? (
          <aside ref={editorRef} className="min-w-0 lg:sticky lg:top-4 lg:self-start">
            <Card className="p-4">
              <TechnicianForm
                key={editing === 'new' ? 'new' : editing.id}
                member={editing === 'new' ? undefined : editing}
                first={editing === 'new' && (team?.length ?? 0) === 0}
                dayStart={settings.dayStart}
                onCancel={() => setEditing(null)}
                onSaved={() => void saved()}
              />
            </Card>
          </aside>
        ) : null}
      </div>
      )}
    </div>
  );
}
