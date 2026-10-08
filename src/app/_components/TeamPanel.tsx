'use client';

import { Loader2, MapPin, Pencil, Plus, UserCheck, UserX, Users, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CERT_TYPES, LEGAL_GATE_CERTS, type CreateTechnicianBody } from '../../shared/contracts/technicians';
import { CLUSTER_LABEL, clusterForPostal } from '../../location/postal';
import { DeskApiError, deskApi, type TeamMember } from './desk-api';
import { cn } from './lib/utils';

const CERT_LABEL: Record<(typeof CERT_TYPES)[number], string> = {
  WSH_PASS: 'WSH pass',
  NITEC_HVAC: 'NITEC HVAC',
  NEA_R32: 'NEA R32 (refrigerant)',
  EMA_LEW: 'EMA LEW (electrical)',
  BCA_STRUCTURAL: 'BCA structural',
};

const FIELD =
  'w-full min-w-0 rounded-md border bg-transparent px-2 py-1 text-[12px] outline-none placeholder:text-muted-foreground focus:border-ring [color-scheme:dark]';
const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-ring/60';

/**
 * Team setup: who works here, what they are certified for, what they carry and
 * where their day starts. Eligibility reads these directly, so a change is in
 * force at the next plan. New technicians work every day from 08:00.
 */
export function TeamPanel({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [editing, setEditing] = useState<TeamMember | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  // Nobody yet: go straight to adding the first person, once per opening.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (team && team.length === 0 && !autoOpened.current) {
      autoOpened.current = true;
      setEditing('new');
    }
  }, [team]);

  const saved = async () => {
    setEditing(null);
    await reload();
    onChanged();
  };

  const toggleActive = async (t: TeamMember) => {
    try {
      await deskApi.updateTechnician(t.id, { isActive: !t.isActive });
      await saved();
    } catch {
      setError(`Could not update ${t.name}.`);
    }
  };

  const active = (team ?? []).filter((t) => t.isActive);
  const inactive = (team ?? []).filter((t) => !t.isActive);

  return (
    <section
      aria-label="Team setup"
      className="grid max-h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border bg-card shadow-[0_24px_50px_-20px_rgb(0_0_0/0.8)]"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && editing === null) onClose();
      }}
    >
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Users className="size-4" />
          Your team
          {team ? <span className="text-xs font-normal text-muted-foreground">{active.length} active</span> : null}
        </span>
        <span className="flex items-center gap-1">
          {editing === null ? (
            <button
              type="button"
              onClick={() => setEditing('new')}
              className={cn('inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11.5px] font-semibold text-primary-foreground', FOCUS)}
            >
              <Plus className="size-3.5" />
              Add technician
            </button>
          ) : null}
          <button type="button" onClick={onClose} aria-label="Close team setup" className={cn('grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent', FOCUS)}>
            <X className="size-4" />
          </button>
        </span>
      </header>

      <div className="min-h-0 overflow-y-auto">
        {error ? <p role="alert" className="px-4 py-2 text-xs text-destructive">{error}</p> : null}
        {editing ? (
          <TechnicianForm
            member={editing === 'new' ? undefined : editing}
            first={editing === 'new' && (team?.length ?? 0) === 0}
            onCancel={() => setEditing(null)}
            onSaved={saved}
          />
        ) : null}
        {!team ? (
          <p className="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading the team…
          </p>
        ) : (
          <ul>
            {[...active, ...inactive].map((t) => (
              <li key={t.id} className={cn('grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 border-b px-4 py-2.5', !t.isActive && 'opacity-55')}>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold">
                    {t.name} <span className="font-normal text-muted-foreground">· tier {t.tier}</span>
                    {!t.isActive ? <span className="font-normal text-muted-foreground"> · off the team</span> : null}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {t.currentCluster ? CLUSTER_LABEL[t.currentCluster as keyof typeof CLUSTER_LABEL] ?? t.currentCluster : t.homeRegion}
                    {' · '}
                    {t.maxMinutesDay / 60} h/day{t.acceptsOt ? ' · overtime ok' : ''}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {t.certs.map((c) => (
                      <span
                        key={c.id}
                        className={cn('rounded border px-1 text-[10.5px]', LEGAL_GATE_CERTS.includes(String(c.certType)) ? 'border-primary/40 text-primary' : 'text-muted-foreground')}
                        title={c.expiresAt ? `Expires ${c.expiresAt}` : 'No expiry on file'}
                      >
                        {String(c.certType).replace('_', ' ')}
                        {c.expiresAt ? ` · ${c.expiresAt}` : ''}
                      </span>
                    ))}
                    {(t.parts ?? []).map((p) => (
                      <span key={p} className="rounded border border-dashed px-1 text-[10.5px] text-muted-foreground">carries {p.replace(/_/g, ' ')}</span>
                    ))}
                  </span>
                </span>
                <span className="flex gap-1">
                  <button type="button" onClick={() => setEditing(t)} aria-label={`Edit ${t.name}`} className={cn('grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground', FOCUS)}>
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleActive(t)}
                    aria-label={t.isActive ? `Take ${t.name} off the team` : `Put ${t.name} back on the team`}
                    title={t.isActive ? 'Take off the team (keeps their history)' : 'Put back on the team'}
                    className={cn('grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground', FOCUS)}
                  >
                    {t.isActive ? <UserX className="size-3.5" /> : <UserCheck className="size-3.5" />}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function TechnicianForm({
  member,
  first,
  onCancel,
  onSaved,
}: {
  member?: TeamMember;
  first: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(member?.name ?? '');
  const [tier, setTier] = useState<1 | 2 | 3 | 4>((member?.tier as 1 | 2 | 3 | 4) ?? 2);
  const [postal, setPostal] = useState('');
  const [certs, setCerts] = useState<Record<string, { on: boolean; expiresAt: string }>>(() =>
    Object.fromEntries(
      CERT_TYPES.map((type) => {
        const held = member?.certs.find((c) => c.certType === type);
        return [type, { on: Boolean(held), expiresAt: held?.expiresAt ?? '' }];
      }),
    ),
  );
  const [parts, setParts] = useState((member?.parts ?? []).join(', '));
  const [acceptsOt, setAcceptsOt] = useState(member?.acceptsOt ?? false);
  const [hours, setHours] = useState(String((member?.maxMinutesDay ?? 480) / 60));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cluster = /^\d{6}$/.test(postal) ? clusterForPostal(postal) : null;
  const partList = parts.split(',').map((p) => p.trim().toLowerCase().replace(/\s+/g, '_')).filter(Boolean);
  const hoursNum = Number(hours);
  const problems = [
    !name.trim() && 'a name',
    // New people need a home area; for an edit, a blank postal code keeps theirs.
    (!member || postal) && !cluster && 'a Singapore postal code for where their day starts',
    !(hoursNum >= 2 && hoursNum <= 12) && 'hours per day between 2 and 12',
    partList.some((p) => !/^[a-z0-9_]{1,40}$/.test(p)) && 'parts as simple names (letters, numbers)',
  ].filter(Boolean) as string[];

  const submit = async () => {
    if (problems.length) return;
    setBusy(true);
    setError(null);
    const certList = CERT_TYPES.filter((t) => certs[t]!.on).map((type) => ({
      type,
      ...(certs[type]!.expiresAt ? { expiresAt: certs[type]!.expiresAt } : {}),
    }));
    const body = {
      name: name.trim(),
      tier,
      certs: certList,
      parts: partList,
      acceptsOt,
      maxMinutesDay: Math.round(hoursNum * 60),
    };
    try {
      if (member) await deskApi.updateTechnician(member.id, { ...body, ...(postal ? { homePostalCode: postal } : {}) });
      else await deskApi.addTechnician({ ...body, homePostalCode: postal } as CreateTechnicianBody);
      onSaved();
    } catch (e) {
      setError(e instanceof DeskApiError ? (e.detail ?? e.code) : 'Could not save.');
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-2 border-b bg-accent/20 px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
      aria-label={member ? `Edit ${member.name}` : 'Add a technician'}
    >
      <span className="text-[12.5px] font-semibold">
        {member ? `Edit ${member.name}` : first ? 'Add your first technician' : 'Add a technician'}
      </span>
      {first ? (
        <span className="text-[11.5px] text-muted-foreground">
          Who works for you, what they are certified for and where their day starts. Jobs are only ever given to someone who qualifies.
        </span>
      ) : null}

      <span className="grid grid-cols-[minmax(0,1fr)_88px] gap-1.5">
        <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" autoFocus />
        <select className={FIELD} value={tier} onChange={(e) => setTier(Number(e.target.value) as 1 | 2 | 3 | 4)} aria-label="Skill tier">
          {[1, 2, 3, 4].map((t) => (
            <option key={t} value={t} className="bg-card">
              Tier {t}
            </option>
          ))}
        </select>
      </span>

      <span className="grid gap-1">
        <input
          className={cn(FIELD, 'font-mono')}
          value={postal}
          onChange={(e) => setPostal(e.target.value.trim())}
          placeholder={member ? 'Home postal code (blank keeps it)' : 'Home postal code, where their day starts'}
          aria-label="Home postal code"
          inputMode="numeric"
          maxLength={6}
        />
        {postal.length === 6 ? (
          <span className={cn('flex items-center gap-1 text-[11px]', cluster ? 'text-muted-foreground' : 'text-destructive')}>
            <MapPin className="size-3" />
            {cluster ? CLUSTER_LABEL[cluster] : 'Not a postal code we can place.'}
          </span>
        ) : null}
      </span>

      <fieldset className="grid gap-1">
        <legend className="mb-1 text-[11.5px] font-medium">Certificates</legend>
        {CERT_TYPES.map((type) => (
          <span key={type} className="grid grid-cols-[minmax(0,1fr)_130px] items-center gap-1.5">
            <label className="flex items-center gap-1.5 text-[12px]">
              <input
                type="checkbox"
                checked={certs[type]!.on}
                onChange={(e) => setCerts((c) => ({ ...c, [type]: { ...c[type]!, on: e.target.checked } }))}
              />
              {CERT_LABEL[type]}
              {LEGAL_GATE_CERTS.includes(type) ? <span className="text-[10px] text-primary">legal</span> : null}
            </label>
            <input
              type="date"
              className={cn(FIELD, 'py-0.5 text-[11px]', !certs[type]!.on && 'opacity-40')}
              disabled={!certs[type]!.on}
              value={certs[type]!.expiresAt}
              onChange={(e) => setCerts((c) => ({ ...c, [type]: { ...c[type]!, expiresAt: e.target.value } }))}
              aria-label={`${CERT_LABEL[type]} expires`}
              title="Expiry date (optional)"
            />
          </span>
        ))}
      </fieldset>

      <span className="grid grid-cols-[minmax(0,1fr)_76px] gap-1.5">
        <input className={FIELD} value={parts} onChange={(e) => setParts(e.target.value)} placeholder="Parts on the van, e.g. inverter board" aria-label="Parts carried" />
        <input className={FIELD} value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" aria-label="Hours per day" title="Hours per day" />
      </span>
      <label className="flex items-center gap-1.5 text-[12px]">
        <input type="checkbox" checked={acceptsOt} onChange={(e) => setAcceptsOt(e.target.checked)} />
        Can work up to 2 hours overtime
      </label>

      {error ? <span role="alert" className="text-[11px] text-destructive">{error}</span> : null}
      <span className="text-[11px] text-muted-foreground">
        {problems.length ? `Needs ${problems.join(', ')}.` : member ? 'Changes apply from the next plan.' : 'They work every day from 08:00.'}
      </span>
      <span className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className={cn('rounded-md px-1.5 py-1 text-[11.5px] text-muted-foreground hover:text-foreground', FOCUS)}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || problems.length > 0}
          className={cn('inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11.5px] font-semibold text-primary-foreground disabled:opacity-40', FOCUS)}
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : null}
          {member ? 'Save' : 'Add to the team'}
        </button>
      </span>
    </form>
  );
}
