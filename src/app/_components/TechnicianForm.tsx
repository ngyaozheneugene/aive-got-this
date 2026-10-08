'use client';

import { Loader2, MapPin } from 'lucide-react';
import { useState } from 'react';
import { CERT_TYPES, LEGAL_GATE_CERTS, type CreateTechnicianBody } from '../../shared/contracts/technicians';
import { CLUSTER_LABEL, clusterForPostal } from '../../location/postal';
import { DeskApiError, deskApi, type TeamMember } from './desk-api';
import { cn } from './lib/utils';

export const CERT_LABEL: Record<(typeof CERT_TYPES)[number], string> = {
  WSH_PASS: 'WSH pass',
  NITEC_HVAC: 'NITEC HVAC',
  NEA_R32: 'NEA R32 (refrigerant)',
  EMA_LEW: 'EMA LEW (electrical)',
  BCA_STRUCTURAL: 'BCA structural',
};

export const FIELD =
  'h-8 w-full min-w-0 rounded-md border bg-transparent px-2.5 text-[13px] outline-none placeholder:text-muted-foreground focus:border-ring [color-scheme:dark]';
export const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-ring/60';

/**
 * Adding or editing one technician: tier, certificates, parts on the van and
 * where their day starts. Eligibility reads these directly, so a change is in
 * force at the next plan.
 */
export function TechnicianForm({
  member,
  first,
  dayStart,
  onCancel,
  onSaved,
}: {
  member?: TeamMember;
  first: boolean;
  /** The company's working-day start, for the note on new people. */
  dayStart: string;
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
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
      aria-label={member ? `Edit ${member.name}` : 'Add a technician'}
    >
      <div>
        <h2 className="text-sm font-semibold">{member ? `Edit ${member.name}` : first ? 'Add your first technician' : 'Add a technician'}</h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {first
            ? 'Who works for you, what they are certified for and where their day starts. Jobs are only ever given to someone who qualifies.'
            : member
              ? 'Changes apply from the next plan.'
              : `They work every day from ${dayStart}, the company's working day.`}
        </p>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-2">
        <Field label="Name">
          <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aisha Rahman" autoFocus />
        </Field>
        <Field label="Skill tier">
          <select className={FIELD} value={tier} onChange={(e) => setTier(Number(e.target.value) as 1 | 2 | 3 | 4)}>
            {[1, 2, 3, 4].map((t) => (
              <option key={t} value={t} className="bg-card">
                Tier {t}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Home postal code" hint={member ? 'Where their day starts. Blank keeps the current one.' : 'Where their day starts.'}>
        <input
          className={cn(FIELD, 'font-mono')}
          value={postal}
          onChange={(e) => setPostal(e.target.value.trim())}
          placeholder="6 digits"
          inputMode="numeric"
          maxLength={6}
        />
        {postal.length === 6 ? (
          <span className={cn('mt-1 flex items-center gap-1 text-[11.5px]', cluster ? 'text-muted-foreground' : 'text-destructive')}>
            <MapPin className="size-3" />
            {cluster ? CLUSTER_LABEL[cluster] : 'Not a postal code we can place.'}
          </span>
        ) : null}
      </Field>

      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-[12px] font-medium">Certificates</legend>
        {CERT_TYPES.map((type) => (
          <span key={type} className="grid grid-cols-[minmax(0,1fr)_140px] items-center gap-2">
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={certs[type]!.on}
                onChange={(e) => setCerts((c) => ({ ...c, [type]: { ...c[type]!, on: e.target.checked } }))}
              />
              {CERT_LABEL[type]}
              {LEGAL_GATE_CERTS.includes(type) ? <span className="text-[10.5px] text-primary">legal</span> : null}
            </label>
            <input
              type="date"
              className={cn(FIELD, 'h-7 text-[12px]', !certs[type]!.on && 'opacity-40')}
              disabled={!certs[type]!.on}
              value={certs[type]!.expiresAt}
              onChange={(e) => setCerts((c) => ({ ...c, [type]: { ...c[type]!, expiresAt: e.target.value } }))}
              aria-label={`${CERT_LABEL[type]} expires`}
              title="Expiry date (optional)"
            />
          </span>
        ))}
      </fieldset>

      <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-2">
        <Field label="Parts on the van" hint="Comma separated.">
          <input className={FIELD} value={parts} onChange={(e) => setParts(e.target.value)} placeholder="e.g. inverter board" />
        </Field>
        <Field label="Hours a day">
          <input className={FIELD} value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={acceptsOt} onChange={(e) => setAcceptsOt(e.target.checked)} />
        Can work up to 2 hours overtime
      </label>

      {error ? <span role="alert" className="text-[12px] text-destructive">{error}</span> : null}
      {problems.length ? <span className="text-[12px] text-muted-foreground">Needs {problems.join(', ')}.</span> : null}
      <span className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className={cn('h-8 rounded-md px-3 text-[13px] text-muted-foreground hover:text-foreground', FOCUS)}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || problems.length > 0}
          className={cn('inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-semibold text-primary-foreground disabled:opacity-40', FOCUS)}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {member ? 'Save' : 'Add to the team'}
        </button>
      </span>
    </form>
  );
}

/** A labelled form field with an optional hint. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1">
      <span className="text-[12px] font-medium">{label}</span>
      {children}
      {hint ? <span className="text-[11.5px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}
