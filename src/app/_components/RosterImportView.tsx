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
import {
  LEGAL_GATE_CERTS,
  type ParseRosterResponse,
  type RosterCandidateRow,
  type RosterReadBy,
} from '../../shared/contracts/technicians';
import { checkRoster, toBody } from '../../dispatch/roster-check';
import { DeskApiError, deskApi } from './desk-api';
import { cn } from './lib/utils';

const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-ring/60';
const FIELD =
  'w-full min-w-0 rounded border bg-transparent px-1.5 py-0.5 text-[11px] outline-none placeholder:text-muted-foreground focus:border-ring [color-scheme:dark]';

/** Same limit as the server (ADR 012). */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const READ_BY: Record<RosterReadBy, { label: string; className: string; title: string }> = {
  template: { label: 'Template', className: 'text-emerald-400', title: 'Read by code from the standard template.' },
  assistant: { label: 'Assistant', className: 'text-sky-400', title: 'Read by the assistant; values not in the row were left blank.' },
  keywords: { label: 'Keywords', className: 'text-amber-400', title: 'Read by keyword matching. Check each field.' },
};

const SAMPLE_PERFECT = `name,tier,homePostalCode,certs,parts,maxHoursDay,acceptsOt
Tan Wei,1,048581,WSH_PASS,,8,false
Siti binti Ahmad,3,529544,NEA_R32:2027-12-31;NITEC_HVAC,inverter_board,8,true
Kumar Rajan,3,640605,BCA_STRUCTURAL:2026-11-30;EMA_LEW:2028-06-15,capacitor;copper_pipe,9,true
Mei Lin,2,730123,WSH_PASS;NITEC_HVAC,drain_pipe,8,false
Hafiz Osman,2,460111,NEA_R32:2027-05-20,inverter_board;compressor,8,false`;

const SAMPLE_MESSY = `Staff Name,Skill Level,Home Address & Postal,Certifications on File,Truck Equipment & Stock,Daily Working Hours,Can do OT?
Ah Seng,Senior (Tier 3),"Blk 512 Jurong West St 52, Singapore 640512","NEA R-32 cert (exp: 2027-08-15), Safety Pass (WSH)",inverter board; copper pipes,8.5 hrs,Yes
Nurul Izzah,Tier 2,"Tampines Street 21, Postal 520245","NITEC Aircon Tech, structural bca pass until 2028-04-10",spare capacitor and drain pipe,8,No
Dave Lim,Junior Tech,"Toa Payoh Central S310178","WSH Pass",None,7 hours,no
Venkatesh K,Level 4 (Master),"Woodlands Ave 1, #08-22, 730312","EMA licensed electrician (LEW) exp 2029-01-01; NEA R32 valid till 2026-12-31",inverter_board,10 hours daily,Yes
Marcus Chen,2,"Bedok Reservoir Rd #04-100, S470105","nil",manifold gauge, compressor,8,yes`;

const SAMPLE_DIAGONAL = `Step_0,Step_1,Step_2,Step_3,Step_4,Step_5,Step_6
[Technician: Siti Ahmad],,,,,,
,Level: Tier 3,,,,,
,,Base Postal: 520112 (Tampines),,,,
,,,Certs: NEA_R32 (exp 2028-02-15) & NITEC HVAC,,,
,,,,Van Stock: inverter_board; copper_pipe,,,
,,,,,Shift: 8 hrs / day,,
,,,,,,OT: Yes
[Technician: Nathan Tan],,,,,,
,Level: Tier 1,,,,,
,,Base Postal: 048624 (CBD),,,,
,,,Certs: WSH Pass,,,
,,,,Van Stock: None,,,
,,,,,Shift: 7.5 hours,,
,,,,,,OT: No
[Technician: Muhammad Hafiz],,,,,,
,Level: Tier 2,,,,,
,,Base Postal: 730888 (Woodlands),,,,
,,,Certs: BCA Structural (expires 2027-11-20),,,
,,,,Van Stock: capacitor; compressor,,,
,,,,,Shift: 9 hours,,
,,,,,,OT: Yes`;

export function RosterImportView({
  onCancel,
  onImported,
}: {
  onCancel: () => void;
  onImported: () => void;
}) {
  const [candidates, setCandidates] = useState<RosterCandidateRow[] | null>(null);
  const [meta, setMeta] = useState<ParseRosterResponse | null>(null);
  const [filename, setFilename] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => {
    const blob = new Blob([SAMPLE_PERFECT], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'technicians_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const read = async (input: Parameters<typeof deskApi.parseRoster>[0], name: string) => {
    setLoading(true);
    setError(null);
    setFilename(name);
    try {
      const res = await deskApi.parseRoster(input);
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
      setError('Roster files are limited to 2 MB.');
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    await read({ fileBase64: btoa(binary), filename: file.name }, file.name);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped) void handleFile(dropped);
  };

  // Every edit re-runs the same checks the server ran, so a fixed field's issue clears.
  const recheck = (rows: RosterCandidateRow[]) => setCandidates(checkRoster(rows, meta?.teamNames ?? []));
  const updateCandidate = (index: number, patch: Partial<RosterCandidateRow>) => {
    if (candidates) recheck(candidates.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };
  const removeCandidate = (index: number) => {
    if (candidates) recheck(candidates.filter((_, i) => i !== index));
  };

  const handleConfirmImport = async () => {
    const ready = (candidates ?? []).filter((c) => c.isValid);
    if (!ready.length) return;
    setImporting(true);
    setError(null);
    try {
      await deskApi.importTechnicians(ready.map(toBody));
      onImported();
    } catch (e) {
      setError(e instanceof DeskApiError ? (e.detail ?? e.code) : 'Could not add the technicians.');
      setImporting(false);
    }
  };

  const validCount = candidates?.filter((c) => c.isValid).length ?? 0;
  const invalidCount = (candidates?.length ?? 0) - validCount;
  const byWay = (candidates ?? []).reduce<Partial<Record<RosterReadBy, number>>>((acc, c) => ({ ...acc, [c.readBy]: (acc[c.readBy] ?? 0) + 1 }), {});

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card text-foreground">
      <div className="flex items-center justify-between border-b bg-muted/20 px-4 py-2.5">
        <div>
          <h2 className="flex items-center gap-1.5 text-xs font-semibold">
            <FileSpreadsheet className="size-3.5 text-primary" />
            Import a team roster
          </h2>
          <p className="text-[11px] text-muted-foreground">
            CSV, Excel (.xlsx) or Parquet, up to 2 MB. Nothing is added until you check the rows and confirm.
          </p>
        </div>
        <button
          type="button"
          onClick={downloadTemplate}
          className={cn('inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-accent', FOCUS)}
        >
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
              onDrop={handleDrop}
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
                <div>
                  <span className="block text-xs font-semibold">{loading ? 'Reading the roster…' : 'Click to upload, or drop a file here'}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    The standard template is read directly; any other layout is read by the assistant, a few rows at a time.
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-lg border bg-card/60 p-3">
              <span className="mb-2 block text-[11px] font-semibold text-muted-foreground">Or try a sample:</span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {[
                  { text: SAMPLE_PERFECT, file: 'technicians_perfect.csv', icon: <Zap className="size-3 text-emerald-400" />, title: 'Standard template', note: 'Read directly, no assistant' },
                  { text: SAMPLE_MESSY, file: 'technicians_messy.csv', icon: <Sparkles className="size-3 text-sky-400" />, title: 'Messy spreadsheet', note: 'Free-text certificates, addresses, OT' },
                  { text: SAMPLE_DIAGONAL, file: 'technicians_diagonal.csv', icon: <FileText className="size-3 text-amber-400" />, title: 'One fact per line', note: 'A block per technician' },
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
                <span className="font-medium">
                  {candidates.length} {candidates.length === 1 ? 'technician' : 'technicians'} in {filename}
                </span>
                {(Object.keys(byWay) as RosterReadBy[]).map((k) => (
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
                <button
                  type="button"
                  onClick={() => setCandidates(null)}
                  className={cn('inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground', FOCUS)}
                >
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
                    <th className="min-w-[150px] px-2 py-1.5">Name</th>
                    <th className="w-24 px-2 py-1.5">Tier</th>
                    <th className="min-w-[140px] px-2 py-1.5">Postal and area</th>
                    <th className="min-w-[160px] px-2 py-1.5">Certificates</th>
                    <th className="min-w-[120px] px-2 py-1.5">Van parts</th>
                    <th className="w-20 px-2 py-1.5">Hours a day</th>
                    <th className="w-12 px-2 py-1.5 text-center">OT</th>
                    <th className="w-8 px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {candidates.map((c, idx) => (
                    <React.Fragment key={`${c.sourceRow}-${idx}`}>
                      <tr className={cn(!c.isValid && 'bg-destructive/5')}>
                        <td className="px-2 pt-2 text-center align-top">
                          {c.isValid ? (
                            <span title="Ready to add" className="mx-auto grid size-4 place-items-center rounded-full bg-emerald-500/20 text-emerald-400">
                              <Check className="size-2.5" />
                            </span>
                          ) : (
                            <span title={c.issues.join(' ')} className="mx-auto grid size-4 place-items-center rounded-full bg-destructive/20 text-destructive">
                              <AlertCircle className="size-2.5" />
                            </span>
                          )}
                        </td>
                        <td className="px-2 pt-2 align-top">
                          <input className={FIELD} value={c.name} onChange={(e) => updateCandidate(idx, { name: e.target.value })} placeholder="Name" aria-label={`Name, row ${c.sourceRow}`} />
                          <span className="mt-0.5 block text-[10px] text-muted-foreground">
                            Row {c.sourceRow} · <span className={READ_BY[c.readBy].className} title={READ_BY[c.readBy].title}>{READ_BY[c.readBy].label}</span>
                          </span>
                        </td>
                        <td className="px-2 pt-2 align-top">
                          <select
                            className={cn(FIELD, c.tier === null && 'border-destructive/60')}
                            value={c.tier ?? ''}
                            onChange={(e) => updateCandidate(idx, { tier: e.target.value ? (Number(e.target.value) as 1 | 2 | 3 | 4) : null })}
                            aria-label={`Tier, row ${c.sourceRow}`}
                          >
                            <option value="" className="bg-card">Choose…</option>
                            {[1, 2, 3, 4].map((t) => (
                              <option key={t} value={t} className="bg-card">Tier {t}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 pt-2 align-top">
                          <input
                            className={cn(FIELD, 'font-mono', !c.cluster && 'border-destructive/60')}
                            value={c.homePostalCode}
                            maxLength={6}
                            inputMode="numeric"
                            onChange={(e) => updateCandidate(idx, { homePostalCode: e.target.value.trim() })}
                            placeholder="6 digits"
                            aria-label={`Postal code, row ${c.sourceRow}`}
                          />
                          <span className={cn('mt-0.5 flex items-center gap-1 text-[10px]', c.cluster ? 'text-muted-foreground' : 'text-destructive')}>
                            <MapPin className="size-2.5" />
                            {c.cluster ?? 'Not placed'}
                          </span>
                        </td>
                        <td className="px-2 pt-2 align-top">
                          <div className="flex flex-wrap gap-1">
                            {c.certs.length === 0 ? <span className="text-[10px] text-muted-foreground italic">None</span> : null}
                            {c.certs.map((cert) => (
                              <span
                                key={cert.type}
                                className={cn('rounded border px-1 text-[9.5px]', LEGAL_GATE_CERTS.includes(cert.type) ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground')}
                              >
                                {cert.type.replace('_', ' ')}
                                {cert.expiresAt ? ` (${cert.expiresAt})` : ''}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-2 pt-2 align-top">
                          <div className="flex flex-wrap gap-1">
                            {c.parts.length === 0 ? <span className="text-[10px] text-muted-foreground italic">None listed</span> : null}
                            {c.parts.map((p) => (
                              <span key={p} className="rounded border border-dashed border-border px-1 text-[9.5px] text-muted-foreground">
                                {p.replace(/_/g, ' ')}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-2 pt-2 align-top">
                          <input
                            className={cn(FIELD, 'font-mono', c.maxMinutesDay === null && 'border-destructive/60')}
                            type="number"
                            min={2}
                            max={12}
                            step={0.5}
                            value={c.maxMinutesDay === null ? '' : c.maxMinutesDay / 60}
                            onChange={(e) => updateCandidate(idx, { maxMinutesDay: e.target.value === '' ? null : Math.round(Number(e.target.value) * 60) })}
                            aria-label={`Hours a day, row ${c.sourceRow}`}
                          />
                        </td>
                        <td className="px-2 pt-2 text-center align-top">
                          <input
                            type="checkbox"
                            checked={c.acceptsOt}
                            onChange={(e) => updateCandidate(idx, { acceptsOt: e.target.checked })}
                            className="size-3.5 rounded"
                            aria-label={`Overtime, row ${c.sourceRow}`}
                          />
                        </td>
                        <td className="px-2 pt-2 text-center align-top">
                          <button
                            type="button"
                            onClick={() => removeCandidate(idx)}
                            className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            title="Leave this row out"
                            aria-label={`Leave out row ${c.sourceRow}`}
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </td>
                      </tr>
                      <tr className={cn(!c.isValid && 'bg-destructive/5')}>
                        <td />
                        <td colSpan={8} className="px-2 pb-2 text-[10.5px]">
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
                <span className="mb-0.5 block font-semibold">Not read as technicians</span>
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
              <span className="text-[11px] text-muted-foreground">
                {invalidCount} {invalidCount === 1 ? 'row' : 'rows'} with issues won’t be added.
              </span>
            ) : null}
            <button
              type="button"
              disabled={importing || validCount === 0}
              onClick={() => void handleConfirmImport()}
              className={cn('inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition disabled:opacity-40', FOCUS)}
            >
              {importing ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
              Add {validCount} {validCount === 1 ? 'technician' : 'technicians'}
            </button>
          </span>
        ) : null}
      </footer>
    </div>
  );
}
