'use client';

import { Loader2, MapPin } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { JobType } from '../../shared/types/domain';
import type { CreateJobBody } from '../../shared/contracts/jobs';
import { CLUSTER_LABEL, clusterForPostal } from '../../location/postal';
import { cn } from './lib/utils';

export type BookableType = JobType & { certs: string[] };

const PRIORITIES: Array<[CreateJobBody['priority'], string]> = [
  ['urgent', 'Urgent'],
  ['on_demand', 'Normal'],
  ['when_available', 'When free'],
];

const FIELD =
  'w-full min-w-0 rounded-md border bg-transparent px-2 py-1 text-[12px] outline-none placeholder:text-muted-foreground focus:border-ring [color-scheme:dark]';
const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-ring/60';

/**
 * A phone call for a job that is not on the board yet. Booking saves it as a
 * waiting job and immediately asks for options, as "Find a technician" does.
 * Returns an error message from `onBook` to show here, or null on success.
 */
export function NewJobForm({
  loadTypes,
  onBook,
  onCancel,
  submitLabel = 'Book and find options',
}: {
  loadTypes: () => Promise<BookableType[]>;
  onBook: (body: CreateJobBody, typeName: string) => Promise<string | null>;
  onCancel: () => void;
  /** The Jobs page books without planning; the board books and asks for options. */
  submitLabel?: string;
}) {
  const [types, setTypes] = useState<BookableType[] | null>(null);
  const [form, setForm] = useState({
    customerName: '',
    phone: '',
    postalCode: '',
    address: '',
    unitNo: '',
    jobTypeId: '',
    priority: 'urgent' as CreateJobBody['priority'],
    windowStart: '13:00',
    windowEnd: '17:00',
    note: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadTypes()
      .then((t) => {
        if (!live) return;
        setTypes(t);
        setForm((f) => (f.jobTypeId ? f : { ...f, jobTypeId: t[0]?.id ?? '' }));
      })
      .catch(() => live && setError('Could not load job types.'));
    return () => {
      live = false;
    };
  }, [loadTypes]);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const cluster = /^\d{6}$/.test(form.postalCode) ? clusterForPostal(form.postalCode) : null;
  const type = types?.find((t) => t.id === form.jobTypeId);
  const windowMinutes = minutes(form.windowEnd) - minutes(form.windowStart);
  const problems = [
    !form.customerName.trim() && 'customer name',
    !/^(\+?65)?[\s-]*[3689]\d{3}[\s-]?\d{4}$/.test(form.phone.trim()) && 'an 8-digit phone number',
    !cluster && 'a Singapore postal code',
    !form.address.trim() && 'the street address',
    !type && 'a job type',
  ].filter(Boolean) as string[];
  const windowProblem =
    windowMinutes <= 0 ? 'The window must end after it starts.' :
    type && windowMinutes < type.defaultMinutes ? `A ${type.name} takes ${type.defaultMinutes} min; widen the window.` : null;
  const ready = problems.length === 0 && !windowProblem && !busy;

  const submit = async () => {
    if (!ready || !type) return;
    setBusy(true);
    setError(null);
    const message = await onBook(
      {
        customerName: form.customerName.trim(),
        phone: form.phone.trim(),
        postalCode: form.postalCode.trim(),
        address: form.address.trim(),
        unitNo: form.unitNo.trim() || undefined,
        jobTypeId: form.jobTypeId,
        priority: form.priority,
        windowStart: form.windowStart,
        windowEnd: form.windowEnd,
        note: form.note.trim() || undefined,
      },
      type.name,
    );
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <form
      className="grid min-w-0 gap-2 border-b bg-accent/20 px-3.5 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
      aria-label="Book a new job"
    >
      <span className="text-[12.5px] font-semibold">New job</span>

      <span className="grid grid-cols-2 gap-1.5">
        <input className={FIELD} value={form.customerName} onChange={set('customerName')} placeholder="Customer name" aria-label="Customer name" autoFocus />
        <input className={FIELD} value={form.phone} onChange={set('phone')} placeholder="Phone" aria-label="Phone" inputMode="tel" />
      </span>

      <span className="grid grid-cols-[72px_minmax(0,1fr)_52px] gap-1.5">
        <input className={cn(FIELD, 'font-mono')} value={form.postalCode} onChange={set('postalCode')} placeholder="Postal" aria-label="Postal code" inputMode="numeric" maxLength={6} />
        <input className={FIELD} value={form.address} onChange={set('address')} placeholder="Street address" aria-label="Street address" />
        <input className={FIELD} value={form.unitNo} onChange={set('unitNo')} placeholder="Unit" aria-label="Unit number" />
      </span>
      {form.postalCode.length === 6 ? (
        <span className={cn('flex items-center gap-1 text-[11px]', cluster ? 'text-muted-foreground' : 'text-destructive')}>
          <MapPin className="size-3" />
          {cluster ? CLUSTER_LABEL[cluster] : 'Not a postal code we can place.'}
        </span>
      ) : null}

      <select className={FIELD} value={form.jobTypeId} onChange={set('jobTypeId')} aria-label="Job type" disabled={!types}>
        {types ? null : <option>Loading job types…</option>}
        {types?.map((t) => (
          <option key={t.id} value={t.id} className="bg-card">
            {t.name} · {t.defaultMinutes} min · tier {t.minTier}+{t.certs.length ? ` · ${t.certs.join(', ')}` : ''}
          </option>
        ))}
      </select>

      <span role="radiogroup" aria-label="Priority" className="flex gap-1">
        {PRIORITIES.map(([p, label]) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={form.priority === p}
            onClick={() => setForm((f) => ({ ...f, priority: p }))}
            className={cn('flex-1 rounded-md border px-1.5 py-0.5 text-[11px] hover:bg-accent', form.priority === p && 'border-primary bg-primary/10', FOCUS)}
          >
            {label}
          </button>
        ))}
      </span>

      <span className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>Window</span>
        <input type="time" step={900} className={cn(FIELD, 'font-mono')} value={form.windowStart} onChange={set('windowStart')} aria-label="Window opens" />
        <span>to</span>
        <input type="time" step={900} className={cn(FIELD, 'font-mono')} value={form.windowEnd} onChange={set('windowEnd')} aria-label="Window closes" />
      </span>

      <textarea
        className={cn(FIELD, 'min-h-12 resize-y')}
        value={form.note}
        onChange={set('note')}
        placeholder="What the customer said (optional)"
        aria-label="Customer note"
        maxLength={1000}
      />

      {windowProblem ? <span className="text-[11px] text-destructive">{windowProblem}</span> : null}
      {error ? <span role="alert" className="text-[11px] text-destructive">{error}</span> : null}

      <span className="text-[11px] text-muted-foreground">
        {problems.length ? `Needs ${problems.join(', ')}.` : 'Saved as waiting, then the assistant finds options.'}
      </span>
      <span className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className={cn('rounded-md px-1.5 py-1 text-[11.5px] text-muted-foreground hover:text-foreground', FOCUS)}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={!ready}
          className={cn('inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11.5px] font-semibold text-primary-foreground disabled:opacity-40', FOCUS)}
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : null}
          {submitLabel}
        </button>
      </span>
    </form>
  );
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
