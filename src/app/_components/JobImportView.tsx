'use client';

import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  MapPin,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  Zap,
} from 'lucide-react';
import React, { useRef, useState } from 'react';
import type { JobCandidateRow, JobPriority, ParseJobsResponse } from '../../shared/contracts/jobs';
import { addDays } from '../../shared/config/demo';
import { checkJobs, toJobBody } from '../../dispatch/job-import-check';
import { DeskApiError, deskApi } from './desk-api';
import { cn } from './lib/utils';

const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-ring/60';
const FIELD =
  'w-full min-w-0 rounded border bg-transparent px-1.5 py-0.5 text-[11px] outline-none placeholder:text-muted-foreground focus:border-ring [color-scheme:dark]';
const BAD = 'border-destructive/60';

/** Same limit as the server (ADR 013). */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const READ_BY: Record<JobCandidateRow['readBy'], { label: string; className: string; title: string }> = {
  template: { label: 'Template', className: 'text-emerald-400', title: 'Read by code from the standard template.' },
  assistant: { label: 'Assistant', className: 'text-sky-400', title: 'Read by the assistant; values not in the row were left blank.' },
  keywords: { label: 'Keywords', className: 'text-amber-400', title: 'Read by keyword matching. Check each field.' },
};

const PRIORITY: Record<JobPriority, string> = { urgent: 'Urgent', on_demand: 'On demand', when_available: 'When available' };

const SAMPLE_PERFECT = `customerName,phone,postalCode,address,unitNo,jobTypeId,priority,windowStart,windowEnd,note
Raffles Place Capital,91234567,048616,1 Raffles Place,#12-01,WATER_LEAK,urgent,09:00,12:00,Severe water leaking from ceiling fan coil in server room
Tan Household (Simei),92345678,520123,Simei St 1,#04-12,GENERAL_SERVICE,on_demand,14:00,16:30,Routine maintenance and filter cleaning for 3 bedrooms
Jurong Gateway Offices,83456789,608549,Jurong Gateway Rd,#09-22,CRITICAL_HVAC_ELECTRICAL,urgent,08:30,11:30,Inverter tripped with burning smell. Needs master tech with spare inverter board
Causeway Point Clinic,94567890,738099,Woodlands Square,#02-15,GAS_TOPUP,on_demand,13:00,15:30,Aircon blowing room temperature air. R32 refrigerant low pressure detected
Bishan Park Condo MCST,85678901,570123,Bishan St 13,#01-05,CHEMICAL_WASH,when_available,10:00,13:00,Chemical wash for management office unit before annual inspection`;

const SAMPLE_MESSY = `Client Name,Contact Number,Service Location,Reported Issue / Symptoms,Preferred Slot,Service Type,Urgency
Far East Medical,65 9188 2345,"Novena Specialist Centre, 10 Sinaran Dr #08-14, Singapore 307506","Severe water dripping onto ultrasound machine, need emergency response!","First thing in morning (08:30 - 11:30)",Water Leaking,Urgent
Uncle Teo (Bedok),+65 8299-1122,"Blk 218 Bedok North St 1 #05-18, S460218","Living room daikin aircon blowing hot air and blinking error code U4","Afternoon 2pm to 5pm",Refrigerant / Gas Check,High
Desmond Goh,96554321,"Tampines Street 21, Block 245, Postal 520245","Scheduled 3-month regular aircon cleaning for 4 units in flat","Flexible morning 10:00 - 12:30",Regular Servicing,Normal
Bukit Merah Cold Storage,+65-9711-8899,"150123 Bukit Merah View #01-105","Outdoor condenser unit noisy humming with electrical burning odor","Urgent slot between 09:00 and 12:00",Electrical / Compressor,ASAP
Punggol Waterway Condo,8122-3344,"Punggol Field Blk 288 #14-22, S828288","Full deep chemical overhaul requested for master bedroom aircon before baby arrives","14:00 to 17:00",Chemical Flush,When Available`;

const SAMPLE_SCRAMBLED = `col_ticket_ref,col_payload_a,col_payload_b,col_payload_c,col_payload_d,col_payload_e,col_payload_f
TICK-001,640441,91234567,"Tan Ah Teck",WATER_LEAK,"16:00 - 10:00",YES_URGENT
TICK-002,"#REF! [CORRUPT_RECORD]",1234,999999,"UNKNOWN_JOB_TYPE","00:00 - 00:00","MAYBE"
TICK-003,WATER_LEAK,"Marina Bay Sands",000000,"+1-800-CALL-AC","14:00 - 14:10","urgent"
TICK-004,"Missing Contact",INVALID_PHONE,730123,"Woodlands Dr 14",CHEMICAL_WASH,"N/A"
TICK-005,98765432,529510,"Tampines Hub","12:00 - 11:00",CRITICAL_HVAC,"100_PERCENT"`;

/**
 * Booking jobs from a file (ADR 013). The server reads the file; every row is
 * shown with how it was read, what is unclear and why. Nothing is booked
 * until the coordinator confirms, and only rows without issues are booked.
 * Booked jobs land on the board waiting for a technician, like any booking.
 */
export function JobImportView({ onCancel, onImported }: { onCancel: () => void; onImported: () => void }) {
  const [candidates, setCandidates] = useState<JobCandidateRow[] | null>(null);
  const [meta, setMeta] = useState<ParseJobsResponse | null>(null);
  const [filename, setFilename] = useState('');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([SAMPLE_PERFECT], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jobs_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const read = async (input: Parameters<typeof deskApi.parseJobs>[0], name: string) => {
    setLoading(true);
    setError(null);
    setFilename(name);
    try {
      const res = await deskApi.parseJobs(input);
      setMeta(res);
      setCandidates(res.candidates);
    } catch (e) {
      setError(e instanceof DeskApiError ? (e.detail ?? e.code) : 'Could not read the file.');
      setCandidates(null);
    } finally {
      setLoading(false);
    }
  };

  // The server reads every format; the browser only uploads the bytes.
  const handleFile = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      setError('Job files are limited to 2 MB.');
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    await read({ fileBase64: btoa(binary), filename: file.name }, file.name);
  };

  // Every edit re-runs the server's checks, so a fixed field's issue clears.
  const recheck = (rows: JobCandidateRow[]) => meta && setCandidates(checkJobs(rows, meta.context));
  const update = (index: number, patch: Partial<JobCandidateRow>) => candidates && recheck(candidates.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  const remove = (index: number) => candidates && recheck(candidates.filter((_, i) => i !== index));

  const confirm = async () => {
    const ready = (candidates ?? []).filter((c) => c.isValid);
    if (!ready.length) return;
    setImporting(true);
    setError(null);
    try {
      await deskApi.importJobs(ready.map(toJobBody));
      onImported();
    } catch (e) {
      setError(e instanceof DeskApiError ? (e.detail ?? e.code) : 'Could not book the jobs.');
      setImporting(false);
    }
  };

  const validCount = candidates?.filter((c) => c.isValid).length ?? 0;
  const invalidCount = (candidates?.length ?? 0) - validCount;
  const byWay = (candidates ?? []).reduce<Partial<Record<JobCandidateRow['readBy'], number>>>((acc, c) => ({ ...acc, [c.readBy]: (acc[c.readBy] ?? 0) + 1 }), {});
  const today = meta?.context.today;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card text-foreground">
      <div className="flex items-center justify-between border-b bg-muted/20 px-4 py-2.5">
        <div>
          <h2 className="flex items-center gap-1.5 text-xs font-semibold">
            <FileSpreadsheet className="size-3.5 text-primary" />
            Import jobs
          </h2>
          <p className="text-[11px] text-muted-foreground">
            CSV, Excel (.xlsx) or Parquet, up to 2 MB. Nothing is booked until you check the rows and confirm; booked jobs wait for a technician.
          </p>
        </div>
        <button type="button" onClick={downloadTemplate} className={cn('inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-accent', FOCUS)}>
          <Download className="size-3 text-muted-foreground" />
          Template (.csv)
        </button>
      </div>

      {error ? (
        <div role="alert" className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          <AlertCircle className="size-3.5 flex-none" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!candidates ? (
          <div className="grid gap-4">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) void handleFile(f);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'grid cursor-pointer place-items-center rounded-xl border-2 border-dashed border-border/80 bg-accent/10 p-8 text-center transition hover:border-primary/60 hover:bg-accent/25',
                loading && 'pointer-events-none opacity-50',
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.parquet"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void handleFile(f);
                }}
              />
              <div className="flex flex-col items-center gap-2">
                <div className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
                  {loading ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
                </div>
                <span className="block text-xs font-semibold">{loading ? 'Reading the jobs…' : 'Click to upload, or drop a file here'}</span>
                <span className="block text-[11px] text-muted-foreground">
                  The standard template is read directly; any other layout is read by the assistant, a few rows at a time.
                </span>
              </div>
            </div>

            <div className="rounded-lg border bg-card/60 p-3">
              <span className="mb-2 block text-[11px] font-semibold text-muted-foreground">Or try a sample:</span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {[
                  { text: SAMPLE_PERFECT, file: 'jobs_perfect.csv', icon: <Zap className="size-3 text-emerald-400" />, title: 'Standard template', note: 'Read directly, no assistant' },
                  { text: SAMPLE_MESSY, file: 'jobs_messy.csv', icon: <Sparkles className="size-3 text-sky-400" />, title: 'Messy work orders', note: 'Free-text slots, service names, urgency' },
                  { text: SAMPLE_SCRAMBLED, file: 'jobs_scrambled.csv', icon: <FileText className="size-3 text-amber-400" />, title: 'Scrambled export', note: 'Nothing should come through unchecked' },
                ].map((s) => (
                  <button
                    key={s.file}
                    type="button"
                    disabled={loading}
                    onClick={() => void read(s.text, s.file)}
                    className={cn('flex flex-col items-start gap-1 rounded-md border border-border bg-background/50 p-2 text-left transition hover:border-primary/50 hover:bg-accent', FOCUS)}
                  >
                    <span className="flex items-center gap-1 text-[11px] font-semibold">
                      {s.icon}
                      {s.title}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{s.note}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
                <span className="font-medium">{candidates.length} {candidates.length === 1 ? 'job' : 'jobs'} in {filename}</span>
                {(Object.keys(byWay) as Array<JobCandidateRow['readBy']>).map((k) => (
                  <span key={k} className={cn('text-[11px]', READ_BY[k].className)} title={READ_BY[k].title}>
                    {byWay[k]} read by {READ_BY[k].label.toLowerCase()}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {invalidCount > 0 ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400">
                    <AlertTriangle className="size-3" />
                    {invalidCount} {invalidCount === 1 ? 'row needs' : 'rows need'} attention
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                    <CheckCircle2 className="size-3" /> All {validCount} ready
                  </span>
                )}
                <button type="button" onClick={() => setCandidates(null)} className={cn('inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground', FOCUS)}>
                  <RefreshCw className="size-3" /> Change file
                </button>
              </div>
            </div>

            {meta?.assistantUnavailable ? (
              <p className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                The assistant could not read some rows, so they were read by keyword matching. Check those rows field by field.
              </p>
            ) : null}

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full border-collapse text-left text-[11.5px]">
                <thead className="border-b bg-muted/40 text-[10.5px] font-semibold text-muted-foreground uppercase">
                  <tr>
                    <th className="w-8 px-2 py-1.5 text-center">OK</th>
                    <th className="min-w-[150px] px-2 py-1.5">Customer</th>
                    <th className="min-w-[200px] px-2 py-1.5">Where</th>
                    <th className="min-w-[150px] px-2 py-1.5">Job</th>
                    <th className="min-w-[150px] px-2 py-1.5">When</th>
                    <th className="w-8 px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {candidates.map((c, idx) => (
                    <React.Fragment key={`${c.sourceRow}-${idx}`}>
                      <tr className={cn(!c.isValid && 'bg-destructive/5')}>
                        <td className="px-2 pt-2 text-center align-top">
                          <span
                            title={c.isValid ? 'Ready to book' : c.issues.join(' ')}
                            className={cn('mx-auto grid size-4 place-items-center rounded-full', c.isValid ? 'bg-emerald-500/20 text-emerald-400' : 'bg-destructive/20 text-destructive')}
                          >
                            {c.isValid ? <Check className="size-2.5" /> : <AlertCircle className="size-2.5" />}
                          </span>
                        </td>
                        <td className="grid gap-1 px-2 pt-2 align-top">
                          <input className={cn(FIELD, !c.customerName.trim() && BAD)} value={c.customerName} onChange={(e) => update(idx, { customerName: e.target.value })} placeholder="Customer" aria-label={`Customer, row ${c.sourceRow}`} />
                          <input className={cn(FIELD, 'font-mono')} value={c.phone} onChange={(e) => update(idx, { phone: e.target.value })} placeholder="Phone" aria-label={`Phone, row ${c.sourceRow}`} />
                          <span className="text-[10px] text-muted-foreground">
                            Row {c.sourceRow} · <span className={READ_BY[c.readBy].className} title={READ_BY[c.readBy].title}>{READ_BY[c.readBy].label}</span>
                          </span>
                        </td>
                        <td className="px-2 pt-2 align-top">
                          <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-1">
                            <input className={cn(FIELD, 'font-mono', !c.cluster && BAD)} value={c.postalCode} maxLength={6} inputMode="numeric" onChange={(e) => update(idx, { postalCode: e.target.value.trim() })} placeholder="Postal" aria-label={`Postal code, row ${c.sourceRow}`} />
                            <input className={FIELD} value={c.unitNo} onChange={(e) => update(idx, { unitNo: e.target.value })} placeholder="Unit" aria-label={`Unit, row ${c.sourceRow}`} />
                            <input className={cn(FIELD, 'col-span-2', !c.address.trim() && BAD)} value={c.address} onChange={(e) => update(idx, { address: e.target.value })} placeholder="Street address" aria-label={`Address, row ${c.sourceRow}`} />
                          </div>
                          <span className={cn('mt-0.5 flex items-center gap-1 text-[10px]', c.cluster ? 'text-muted-foreground' : 'text-destructive')}>
                            <MapPin className="size-2.5" />
                            {c.cluster ?? 'Not placed'}
                          </span>
                        </td>
                        <td className="grid gap-1 px-2 pt-2 align-top">
                          <select className={cn(FIELD, !c.jobTypeId && BAD)} value={c.jobTypeId ?? ''} onChange={(e) => update(idx, { jobTypeId: e.target.value || null })} aria-label={`Job type, row ${c.sourceRow}`}>
                            <option value="" className="bg-card">Choose…</option>
                            {meta?.context.jobTypes.map((t) => (
                              <option key={t.id} value={t.id} className="bg-card">{t.name}</option>
                            ))}
                          </select>
                          <select className={cn(FIELD, !c.priority && BAD)} value={c.priority ?? ''} onChange={(e) => update(idx, { priority: (e.target.value || null) as JobPriority | null })} aria-label={`Priority, row ${c.sourceRow}`}>
                            <option value="" className="bg-card">Priority…</option>
                            {(Object.keys(PRIORITY) as JobPriority[]).map((p) => (
                              <option key={p} value={p} className="bg-card">{PRIORITY[p]}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 pt-2 align-top">
                          <div className="grid grid-cols-2 gap-1">
                            <input type="time" className={cn(FIELD, !c.windowStart && BAD)} value={c.windowStart ?? ''} onChange={(e) => update(idx, { windowStart: e.target.value || null })} aria-label={`Window start, row ${c.sourceRow}`} />
                            <input type="time" className={cn(FIELD, !c.windowEnd && BAD)} value={c.windowEnd ?? ''} onChange={(e) => update(idx, { windowEnd: e.target.value || null })} aria-label={`Window end, row ${c.sourceRow}`} />
                            {today ? (
                              <select className={cn(FIELD, 'col-span-2')} value={c.date ?? today} onChange={(e) => update(idx, { date: e.target.value === today ? null : e.target.value })} aria-label={`Day, row ${c.sourceRow}`}>
                                <option value={today} className="bg-card">Today</option>
                                <option value={addDays(today, 1)} className="bg-card">Tomorrow</option>
                              </select>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-2 pt-2 text-center align-top">
                          <button type="button" onClick={() => remove(idx)} className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Leave this row out" aria-label={`Leave out row ${c.sourceRow}`}>
                            <Trash2 className="size-3" />
                          </button>
                        </td>
                      </tr>
                      <tr className={cn(!c.isValid && 'bg-destructive/5')}>
                        <td />
                        <td colSpan={5} className="px-2 pb-2 text-[10.5px]">
                          {c.note ? <span className="block truncate text-foreground/70" title={c.note}>“{c.note}”</span> : null}
                          {c.issues.map((i) => (
                            <span key={i} className="block text-destructive">{i}</span>
                          ))}
                          {c.notices.map((n) => (
                            <span key={n} className="block text-muted-foreground">{n}</span>
                          ))}
                        </td>
                      </tr>
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {meta?.skipped.length ? (
              <div className="rounded border bg-accent/15 px-3 py-2 text-[10.5px] text-muted-foreground">
                <span className="mb-0.5 block font-semibold">Not read as jobs</span>
                {meta.skipped.map((s) => (
                  <span key={s.sourceRow} className="block">Row {s.sourceRow}: {s.reason}</span>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between gap-3 border-t bg-muted/20 px-4 py-3">
        <button type="button" onClick={onCancel} disabled={importing} className={cn('rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground', FOCUS)}>
          Cancel
        </button>
        {candidates ? (
          <span className="flex items-center gap-3">
            {invalidCount > 0 && validCount > 0 ? (
              <span className="text-[11px] text-muted-foreground">{invalidCount} {invalidCount === 1 ? 'row' : 'rows'} with issues won’t be booked.</span>
            ) : null}
            <button
              type="button"
              disabled={importing || validCount === 0}
              onClick={() => void confirm()}
              className={cn('inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition disabled:opacity-40', FOCUS)}
            >
              {importing ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
              Book {validCount} {validCount === 1 ? 'job' : 'jobs'}
            </button>
          </span>
        ) : null}
      </footer>
    </div>
  );
}
