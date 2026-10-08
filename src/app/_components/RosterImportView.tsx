'use client';

import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Database,
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
import * as XLSX from 'xlsx';
import {
  CERT_TYPES,
  LEGAL_GATE_CERTS,
  type CreateTechnicianBody,
  type ParseRosterResponse,
  type RosterCandidateRow,
} from '../../shared/contracts/technicians';
import { CLUSTER_LABEL, clusterForPostal } from '../../location/postal';
import { DeskApiError, deskApi } from './desk-api';
import { cn } from './lib/utils';

const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-ring/60';
const FIELD =
  'w-full min-w-0 rounded border bg-transparent px-1.5 py-0.5 text-[11px] outline-none placeholder:text-muted-foreground focus:border-ring [color-scheme:dark]';

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
  const [parseMeta, setParseMeta] = useState<ParseRosterResponse | null>(null);
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

  const processText = async (text: string, name: string) => {
    setLoading(true);
    setError(null);
    setFilename(name);
    try {
      const res = await deskApi.parseRoster(text);
      setParseMeta(res);
      setCandidates(res.candidates);
    } catch (e) {
      setError(e instanceof DeskApiError ? (e.detail ?? e.code) : 'Failed to parse file.');
      setCandidates(null);
    } finally {
      setLoading(false);
    }
  };

  const handleFile = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      let text = '';
      if (file.name.endsWith('.parquet')) {
        const { parquetReadObjects } = await import('hyparquet');
        const { compressors } = await import('hyparquet-compressors');
        const { recordsToCsv } = await import('../../agent/reports/roster-reader');
        const buffer = await file.arrayBuffer();
        const records = await parquetReadObjects({ file: buffer, compressors });
        if (!records || records.length === 0) {
          throw new Error('Parquet file contains no records.');
        }
        text = recordsToCsv(records as Record<string, unknown>[]);
      } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array' });
        const firstSheet = wb.SheetNames[0];
        if (!firstSheet || !wb.Sheets[firstSheet]) {
          throw new Error('No worksheets found in this Excel file.');
        }
        text = XLSX.utils.sheet_to_csv(wb.Sheets[firstSheet]!);
      } else {
        text = await file.text();
      }
      await processText(text, file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read file.');
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped) void handleFile(dropped);
  };

  const updateCandidate = (index: number, patch: Partial<RosterCandidateRow>) => {
    if (!candidates) return;
    setCandidates((prev) => {
      if (!prev) return prev;
      const copy = [...prev];
      const target = { ...copy[index]!, ...patch };

      // Re-validate postal cluster
      const cluster = /^\d{6}$/.test(target.homePostalCode) ? clusterForPostal(target.homePostalCode) : null;
      target.cluster = cluster ? CLUSTER_LABEL[cluster] : null;

      const issues: string[] = [];
      if (!target.name.trim()) issues.push('Technician name is required.');
      if (!cluster) issues.push(`Postal code "${target.homePostalCode}" cannot be placed into a Singapore sector.`);

      target.isValid = issues.length === 0;
      target.issues = issues;
      copy[index] = target;
      return copy;
    });
  };

  const removeCandidate = (index: number) => {
    setCandidates((prev) => (prev ? prev.filter((_, i) => i !== index) : null));
  };

  const handleConfirmImport = async () => {
    if (!candidates || candidates.length === 0) return;
    const validRows = candidates.filter((c) => c.isValid);
    if (validRows.length === 0) {
      setError('No valid technician rows to import. Please correct the highlighted errors.');
      return;
    }

    setImporting(true);
    setError(null);

    const bodies: CreateTechnicianBody[] = validRows.map((c) => ({
      name: c.name.trim(),
      tier: c.tier,
      homePostalCode: c.homePostalCode,
      certs: c.certs.map((cert) => ({
        type: cert.type,
        ...(cert.expiresAt ? { expiresAt: cert.expiresAt } : {}),
      })),
      parts: c.parts,
      maxMinutesDay: c.maxMinutesDay,
      acceptsOt: c.acceptsOt,
    }));

    try {
      await deskApi.importTechnicians(bodies);
      onImported();
    } catch (e) {
      setError(e instanceof DeskApiError ? (e.detail ?? e.code) : 'Failed to import technicians.');
      setImporting(false);
    }
  };

  const validCount = candidates?.filter((c) => c.isValid).length ?? 0;
  const invalidCount = (candidates?.length ?? 0) - validCount;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card text-foreground">
      {/* Subheader */}
      <div className="flex items-center justify-between border-b px-4 py-2.5 bg-muted/20">
        <div>
          <h2 className="text-xs font-semibold flex items-center gap-1.5">
            <FileSpreadsheet className="size-3.5 text-primary" />
            Import Team Roster
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Auto-ingest employees from CSV, Excel (.xlsx), or Apache Parquet (.parquet) data lake files.
          </p>
        </div>
        <button
          type="button"
          onClick={downloadTemplate}
          className={cn(
            'inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-accent',
            FOCUS,
          )}
        >
          <Download className="size-3 text-muted-foreground" />
          Template (.csv)
        </button>
      </div>

      {error ? (
        <div role="alert" className="border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-xs text-destructive flex items-center gap-2">
          <AlertCircle className="size-3.5 flex-none" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!candidates ? (
          <div className="grid gap-4">
            {/* Drag & Drop Area */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'grid place-items-center rounded-xl border-2 border-dashed border-border/80 bg-accent/10 p-8 text-center cursor-pointer transition hover:border-primary/60 hover:bg-accent/25',
                loading && 'pointer-events-none opacity-50',
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv, .xlsx, .xls, .parquet"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
              />
              <div className="flex flex-col items-center gap-2">
                <div className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
                  {loading ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
                </div>
                <div>
                  <span className="text-xs font-semibold block">
                    {loading ? 'Reading & parsing roster...' : 'Click to upload or drag & drop'}
                  </span>
                  <span className="text-[11px] text-muted-foreground block">
                    Supports .csv, .xlsx, .xls, and .parquet data files
                  </span>
                </div>
              </div>
            </div>

            {/* Quick-test with sample files */}
            <div className="rounded-lg border bg-card/60 p-3">
              <span className="text-[11px] font-semibold text-muted-foreground block mb-2">
                Or test with sample scenarios:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void processText(SAMPLE_PERFECT, 'technicians_perfect.csv')}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-md border border-border bg-background/50 p-2 text-left hover:bg-accent hover:border-primary/50 transition',
                    FOCUS,
                  )}
                >
                  <span className="flex items-center gap-1 text-[11px] font-semibold">
                    <Zap className="size-3 text-emerald-400" />
                    Clean Template
                  </span>
                  <span className="text-[10px] text-muted-foreground">Standard 7-column schema</span>
                </button>

                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void processText(SAMPLE_MESSY, 'technicians_messy.csv')}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-md border border-border bg-background/50 p-2 text-left hover:bg-accent hover:border-primary/50 transition',
                    FOCUS,
                  )}
                >
                  <span className="flex items-center gap-1 text-[11px] font-semibold">
                    <Sparkles className="size-3 text-sky-400" />
                    Messy SME Roster
                  </span>
                  <span className="text-[10px] text-muted-foreground">Free-text certs, addresses, OT</span>
                </button>

                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void processText(SAMPLE_DIAGONAL, 'technicians_diagonal.csv')}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-md border border-border bg-background/50 p-2 text-left hover:bg-accent hover:border-primary/50 transition',
                    FOCUS,
                  )}
                >
                  <span className="flex items-center gap-1 text-[11px] font-semibold">
                    <FileText className="size-3 text-amber-400" />
                    Diagonal Layout
                  </span>
                  <span className="text-[10px] text-muted-foreground">Staggered step table</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Pre-Flight Preview & Confirmation Table */
          <div className="grid gap-3">
            {/* Meta status bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2">
                {parseMeta?.source === 'template_fast_path' ? (
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400 border border-emerald-500/20">
                    <Zap className="size-3" /> Standard Template (Instant)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-400 border border-sky-500/20">
                    <Sparkles className="size-3" /> AI Assistant Structured
                  </span>
                )}
                {filename.toLowerCase().endsWith('.parquet') && (
                  <span className="inline-flex items-center gap-1 rounded bg-purple-500/10 px-2 py-0.5 text-[11px] font-medium text-purple-400 border border-purple-500/20">
                    <Database className="size-3" /> Parquet File
                  </span>
                )}
                <span className="text-[11.5px] font-medium">
                  {candidates.length} {candidates.length === 1 ? 'technician' : 'technicians'} detected
                </span>
                <span className="text-xs text-muted-foreground">({filename})</span>
              </div>

              <div className="flex items-center gap-2">
                {invalidCount > 0 ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 font-medium">
                    <AlertTriangle className="size-3" />
                    {invalidCount} {invalidCount === 1 ? 'row needs' : 'rows need'} attention
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                    <CheckCircle2 className="size-3" /> All {validCount} rows ready
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setCandidates(null)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground',
                    FOCUS,
                  )}
                >
                  <RefreshCw className="size-3" /> Change file
                </button>
              </div>
            </div>

            {/* Candidates Table */}
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-[11.5px] border-collapse">
                <thead className="bg-muted/40 text-[10.5px] font-semibold text-muted-foreground uppercase border-b">
                  <tr>
                    <th className="px-2 py-1.5 w-8 text-center">Status</th>
                    <th className="px-2 py-1.5 min-w-[130px]">Name</th>
                    <th className="px-2 py-1.5 w-20">Tier</th>
                    <th className="px-2 py-1.5 min-w-[140px]">Postal & Area</th>
                    <th className="px-2 py-1.5 min-w-[160px]">Certificates</th>
                    <th className="px-2 py-1.5 min-w-[130px]">Van Parts</th>
                    <th className="px-2 py-1.5 w-16 text-center">Hours</th>
                    <th className="px-2 py-1.5 w-14 text-center">OT</th>
                    <th className="px-2 py-1.5 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {candidates.map((c, idx) => (
                    <tr key={idx} className={cn(!c.isValid && 'bg-destructive/5')}>
                      {/* Status */}
                      <td className="px-2 py-2 text-center align-top">
                        {c.isValid ? (
                          <span title="Ready to import" className="grid size-4 place-items-center rounded-full bg-emerald-500/20 text-emerald-400 mx-auto">
                            <Check className="size-2.5" />
                          </span>
                        ) : (
                          <span title={c.issues.join('; ')} className="grid size-4 place-items-center rounded-full bg-destructive/20 text-destructive mx-auto">
                            <AlertCircle className="size-2.5" />
                          </span>
                        )}
                      </td>

                      {/* Name */}
                      <td className="px-2 py-2 align-top">
                        <input
                          className={FIELD}
                          value={c.name}
                          onChange={(e) => updateCandidate(idx, { name: e.target.value })}
                          placeholder="Name"
                        />
                        {c.issues.some((i) => i.includes('name')) ? (
                          <span className="text-[10px] text-destructive block mt-0.5">Name required</span>
                        ) : null}
                      </td>

                      {/* Tier */}
                      <td className="px-2 py-2 align-top">
                        <select
                          className={FIELD}
                          value={c.tier}
                          onChange={(e) => updateCandidate(idx, { tier: Number(e.target.value) as 1 | 2 | 3 | 4 })}
                        >
                          {[1, 2, 3, 4].map((t) => (
                            <option key={t} value={t} className="bg-card">
                              Tier {t}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Postal */}
                      <td className="px-2 py-2 align-top">
                        <div className="grid gap-0.5">
                          <input
                            className={cn(FIELD, 'font-mono')}
                            value={c.homePostalCode}
                            maxLength={6}
                            onChange={(e) => updateCandidate(idx, { homePostalCode: e.target.value.trim() })}
                            placeholder="6-digit postal"
                          />
                          <span className={cn('text-[10px] flex items-center gap-1', c.cluster ? 'text-muted-foreground' : 'text-destructive')}>
                            <MapPin className="size-2.5" />
                            {c.cluster ? c.cluster : 'Unknown Singapore sector'}
                          </span>
                        </div>
                      </td>

                      {/* Certs */}
                      <td className="px-2 py-2 align-top">
                        <div className="flex flex-wrap gap-1">
                          {c.certs.length === 0 ? (
                            <span className="text-[10px] text-muted-foreground italic">None</span>
                          ) : (
                            c.certs.map((cert) => (
                              <span
                                key={cert.type}
                                className={cn(
                                  'rounded border px-1 py-0.2 text-[9.5px]',
                                  LEGAL_GATE_CERTS.includes(cert.type)
                                    ? 'border-primary/40 text-primary'
                                    : 'border-border text-muted-foreground',
                                )}
                              >
                                {cert.type.replace('_', ' ')}
                                {cert.expiresAt ? ` (${cert.expiresAt})` : ''}
                              </span>
                            ))
                          )}
                        </div>
                      </td>

                      {/* Parts */}
                      <td className="px-2 py-2 align-top">
                        <div className="flex flex-wrap gap-1">
                          {c.parts.length === 0 ? (
                            <span className="text-[10px] text-muted-foreground italic">Standard stock</span>
                          ) : (
                            c.parts.map((p) => (
                              <span key={p} className="rounded border border-dashed border-border px-1 py-0.2 text-[9.5px] text-muted-foreground">
                                {p.replace(/_/g, ' ')}
                              </span>
                            ))
                          )}
                        </div>
                      </td>

                      {/* Hours */}
                      <td className="px-2 py-2 align-top text-center">
                        <span className="text-[11px] font-mono">{c.maxMinutesDay / 60}h</span>
                      </td>

                      {/* OT */}
                      <td className="px-2 py-2 align-top text-center">
                        <input
                          type="checkbox"
                          checked={c.acceptsOt}
                          onChange={(e) => updateCandidate(idx, { acceptsOt: e.target.checked })}
                          className="size-3.5 rounded"
                        />
                      </td>

                      {/* Remove */}
                      <td className="px-2 py-2 align-top text-center">
                        <button
                          type="button"
                          onClick={() => removeCandidate(idx)}
                          className="grid size-5 place-items-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          title="Remove row"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {candidates.some((c) => c.notices.length > 0) ? (
              <div className="rounded border bg-accent/15 px-3 py-2 text-[10.5px] text-muted-foreground">
                <span className="font-semibold block mb-0.5">Notices:</span>
                <ul className="list-disc list-inside space-y-0.5">
                  {Array.from(new Set(candidates.flatMap((c) => c.notices))).map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Footer Controls */}
      <footer className="flex items-center justify-between border-t px-4 py-3 bg-muted/20">
        <button
          type="button"
          onClick={onCancel}
          disabled={importing}
          className={cn('rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground', FOCUS)}
        >
          Cancel
        </button>

        {candidates ? (
          <button
            type="button"
            disabled={importing || validCount === 0}
            onClick={() => void handleConfirmImport()}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40 transition',
              FOCUS,
            )}
          >
            {importing ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
            Confirm & Import {validCount} {validCount === 1 ? 'Technician' : 'Technicians'}
          </button>
        ) : null}
      </footer>
    </div>
  );
}
