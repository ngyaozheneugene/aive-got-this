'use client';

import { useCallback, useEffect, useState } from 'react';
import { Building2, Check, FlaskConical, Loader2, Pencil, Plus, RotateCcw, Wrench } from 'lucide-react';
import { DeskApiError, deskApi, type CompanySettings } from '../../_components/desk-api';
import { CERT_LABEL, FIELD, FOCUS, Field } from '../../_components/TechnicianForm';
import { PageHeader } from '../../_components/shell/PageHeader';
import { useWorkspace } from '../../_components/shell/workspace';
import { PROFILE_COPY } from '../../_components/copy';
import { Button } from '../../_components/ui/button';
import { Card } from '../../_components/ui/card';
import { cn } from '../../_components/lib/utils';
import { CERT_TYPES, LEGAL_GATE_CERTS } from '../../../shared/contracts/technicians';
import { workingDayProblem, type CreateJobTypeBody } from '../../../shared/contracts/settings';
import type { JobType } from '../../../shared/types/domain';

type CatalogType = JobType & { certs: string[] };

export default function SettingsPage() {
  const { simulation, reloadSettings } = useWorkspace();
  // A reset replaces what the sections were editing; they start over from it.
  const [generation, setGeneration] = useState(0);
  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader
        title="Settings"
        description={simulation ? 'The sample company’s settings. Changes stay in the simulation.' : 'How your company works. The assistant plans within these.'}
      />
      <div className="grid gap-6 p-4 sm:p-6">
        <CompanySection key={`company-${generation}`} />
        <JobTypesSection key={`types-${generation}`} />
        <SampleDaySection
          onReset={async () => {
            await reloadSettings();
            setGeneration((g) => g + 1);
          }}
        />
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, description, children }: { icon: typeof Building2; title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)] md:gap-6">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </h2>
        <p className="mt-1 text-[12.5px] text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function CompanySection() {
  const { settings, reloadSettings } = useWorkspace();
  const [draft, setDraft] = useState<CompanySettings>(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dirty = (Object.keys(draft) as Array<keyof CompanySettings>).some((k) => draft[k] !== settings[k]);
  const problem = !draft.name.trim() ? 'The company needs a name.' : workingDayProblem(draft);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const changed = Object.fromEntries(
        (Object.keys(draft) as Array<keyof CompanySettings>).filter((k) => draft[k] !== settings[k]).map((k) => [k, draft[k]]),
      );
      await deskApi.updateSettings(changed);
      await reloadSettings();
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof DeskApiError ? (e.detail ?? e.code) : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={Building2} title="Company" description="Your name, your working day, and which option the board recommends first.">
      <Card className="gap-4 p-4">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty && !problem) void save();
          }}
        >
          <Field label="Company name">
            <input className={FIELD} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={80} />
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:max-w-xs">
            <Field label="Working day starts">
              <input type="time" className={FIELD} value={draft.dayStart} onChange={(e) => setDraft({ ...draft, dayStart: e.target.value })} />
            </Field>
            <Field label="Ends">
              <input type="time" className={FIELD} value={draft.dayEnd} onChange={(e) => setDraft({ ...draft, dayEnd: e.target.value })} />
            </Field>
          </div>
          <p className="-mt-2 text-[11.5px] text-muted-foreground">
            Technicians without a set shift clock in at the start. When nobody has set a finish time, free time is counted until the end.
          </p>
          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-[12px] font-medium">Recommend first</legend>
            {(['sla_first', 'minimal_disruption'] as const).map((p) => (
              <label
                key={p}
                className={cn(
                  'flex cursor-pointer gap-2.5 rounded-lg border p-3 transition-colors',
                  draft.defaultProfile === p ? 'border-primary/50 bg-primary/5' : 'hover:bg-accent/40',
                )}
              >
                <input type="radio" name="profile" className="mt-0.5" checked={draft.defaultProfile === p} onChange={() => setDraft({ ...draft, defaultProfile: p })} />
                <span>
                  <span className="block text-[13px] font-medium">{PROFILE_COPY[p].name}</span>
                  <span className="block text-[12px] text-muted-foreground">{PROFILE_COPY[p].promise}</span>
                </span>
              </label>
            ))}
            <span className="text-[11.5px] text-muted-foreground">The board starts on this each time; a coordinator can still switch for one event.</span>
          </fieldset>
          <div className="flex items-center justify-end gap-3">
            {error ? <span role="alert" className="mr-auto text-[12px] text-destructive">{error}</span> : null}
            {!error && problem && dirty ? <span className="mr-auto text-[12px] text-destructive">{problem}</span> : null}
            {savedAt && !dirty ? (
              <span className="flex items-center gap-1 text-[12px] text-success">
                <Check className="size-3.5" /> Saved
              </span>
            ) : null}
            {dirty ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(settings)}>
                Discard
              </Button>
            ) : null}
            <Button type="submit" size="sm" disabled={!dirty || Boolean(problem) || busy}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              Save changes
            </Button>
          </div>
        </form>
      </Card>
    </Section>
  );
}

function JobTypesSection() {
  const [types, setTypes] = useState<CatalogType[] | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setTypes(await deskApi.jobTypes());
    } catch {
      setError('Could not load the job types.');
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <Section
      icon={Wrench}
      title="Job types"
      description="What can be booked: how long it usually takes, the lowest tier that may do it, and the certificates it needs. Changes apply to new bookings."
    >
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <span className="text-[12.5px] text-muted-foreground">{types ? `${types.length} job types` : 'Loading…'}</span>
          <Button size="xs" variant="outline" onClick={() => setEditing('new')} disabled={editing === 'new'}>
            <Plus />
            Add job type
          </Button>
        </div>
        {error ? <p role="alert" className="px-4 py-2 text-[12px] text-destructive">{error}</p> : null}
        {editing === 'new' ? (
          <JobTypeForm
            onCancel={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await reload();
            }}
          />
        ) : null}
        <ul>
          {(types ?? []).map((t) =>
            editing === t.id ? (
              <li key={t.id}>
                <JobTypeForm
                  type={t}
                  onCancel={() => setEditing(null)}
                  onSaved={async () => {
                    setEditing(null);
                    await reload();
                  }}
                />
              </li>
            ) : (
              <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b px-4 py-3 last:border-b-0">
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium">{t.name}</span>
                  <span className="block text-[12px] text-muted-foreground">
                    About {t.defaultMinutes} min · tier {t.minTier} and up
                  </span>
                  {t.certs.length ? (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {t.certs.map((c) => (
                        <span
                          key={c}
                          className={cn('rounded border px-1.5 py-px text-[11px]', LEGAL_GATE_CERTS.includes(c) ? 'border-primary/40 text-primary' : 'text-muted-foreground')}
                        >
                          {c.replace('_', ' ')}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => setEditing(t.id)}
                  aria-label={`Edit ${t.name}`}
                  title="Edit"
                  className={cn('grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground', FOCUS)}
                >
                  <Pencil className="size-4" />
                </button>
              </li>
            ),
          )}
        </ul>
      </Card>
    </Section>
  );
}

function JobTypeForm({ type, onCancel, onSaved }: { type?: CatalogType; onCancel: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(type?.name ?? '');
  const [minTier, setMinTier] = useState<1 | 2 | 3 | 4>((type?.minTier as 1 | 2 | 3 | 4) ?? 1);
  const [minutes, setMinutes] = useState(String(type?.defaultMinutes ?? 60));
  const [certs, setCerts] = useState<string[]>(type?.certs ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minutesNum = Number(minutes);
  const problems = [
    !name.trim() && 'a name',
    !(Number.isInteger(minutesNum) && minutesNum >= 15 && minutesNum <= 480) && 'a duration of 15 to 480 minutes',
  ].filter(Boolean) as string[];

  const submit = async () => {
    if (problems.length) return;
    setBusy(true);
    setError(null);
    const body = { name: name.trim(), minTier, defaultMinutes: minutesNum, certs: certs as CreateJobTypeBody['certs'] };
    try {
      if (type) await deskApi.updateJobType(type.id, body);
      else await deskApi.addJobType(body);
      await onSaved();
    } catch (e) {
      setError(e instanceof DeskApiError ? (e.detail ?? e.code) : 'Could not save.');
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-3 border-b bg-accent/20 px-4 py-3"
      aria-label={type ? `Edit ${type.name}` : 'Add a job type'}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_100px_100px] gap-2">
        <Field label="Name">
          <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Duct cleaning" autoFocus />
        </Field>
        <Field label="Minutes">
          <input className={FIELD} value={minutes} onChange={(e) => setMinutes(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Lowest tier">
          <select className={FIELD} value={minTier} onChange={(e) => setMinTier(Number(e.target.value) as 1 | 2 | 3 | 4)}>
            {[1, 2, 3, 4].map((t) => (
              <option key={t} value={t} className="bg-card">
                Tier {t}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <fieldset className="grid gap-1">
        <legend className="mb-1 text-[12px] font-medium">Certificates needed</legend>
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          {CERT_TYPES.map((c) => (
            <label key={c} className="flex items-center gap-1.5 text-[13px]">
              <input
                type="checkbox"
                checked={certs.includes(c)}
                onChange={(e) => setCerts((cs) => (e.target.checked ? [...cs, c] : cs.filter((x) => x !== c)))}
              />
              {CERT_LABEL[c]}
            </label>
          ))}
        </span>
      </fieldset>
      {error ? <span role="alert" className="text-[12px] text-destructive">{error}</span> : null}
      <span className="flex items-center justify-end gap-2">
        {problems.length ? <span className="mr-auto text-[12px] text-muted-foreground">Needs {problems.join(', ')}.</span> : null}
        {type ? <span className="mr-auto text-[11.5px] text-muted-foreground">Jobs already booked keep what they needed.</span> : null}
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy || problems.length > 0}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          {type ? 'Save' : 'Add job type'}
        </Button>
      </span>
    </form>
  );
}

function SampleDaySection({ onReset }: { onReset: () => Promise<void> }) {
  const { simulation, switchWorkspace } = useWorkspace();
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  const reset = async () => {
    setState('busy');
    try {
      await deskApi.reset();
      setConfirming(false);
      await onReset();
      setState('done');
    } catch {
      setState('error');
    }
  };

  return (
    <Section
      icon={FlaskConical}
      title="Sample day"
      description="A complete company and a busy day to try the assistant on. It lives apart from your workspace."
    >
      <Card className="gap-3 p-4">
        {simulation ? (
          <>
            <p className="text-[13px]">
              Put the sample day back as it started: every booking, absence and decision made in the simulation is cleared.
              Your own workspace is never touched.
            </p>
            <span className="flex flex-wrap items-center gap-2">
              {confirming ? (
                <>
                  <Button variant="destructive" size="sm" onClick={() => void reset()} disabled={state === 'busy'}>
                    {state === 'busy' ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                    Yes, reset the sample day
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
                  <RotateCcw />
                  Reset the sample day
                </Button>
              )}
              {state === 'error' ? <span className="text-[12px] text-destructive">Could not reset.</span> : null}
              {state === 'done' && !confirming ? (
                <span className="flex items-center gap-1 text-[12px] text-success">
                  <Check className="size-3.5" /> The sample day is back to its start.
                </span>
              ) : null}
            </span>
          </>
        ) : (
          <>
            <p className="text-[13px]">
              Fifteen technicians, forty-odd jobs and a stream of things going wrong. Nothing you do there reaches your own team or
              jobs.
            </p>
            <span>
              <Button variant="outline" size="sm" onClick={() => switchWorkspace('simulation')}>
                <FlaskConical className="text-warning" />
                Try a sample day
              </Button>
            </span>
          </>
        )}
      </Card>
    </Section>
  );
}
