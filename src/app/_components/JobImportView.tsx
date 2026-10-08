'use client';

import {
  AlertCircle,
  AlertTriangle,
  Briefcase,
  Check,
  CheckCircle2,
  Clock,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  MapPin,
  Sparkles,
  Trash2,
  Upload,
  Zap,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import type { CreateJobBody, JobCandidateRow, ParseJobsResponse } from '../../shared/contracts/jobs';
import { CLUSTER_LABEL, clusterForPostal } from '../../location/postal';
import { DeskApiError, deskApi } from './desk-api';
import { cn } from './lib/utils';
import type { BookableType } from './NewJobForm';

const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-ring/60';
const FIELD =
  'w-full min-w-0 rounded border bg-transparent px-1.5 py-0.5 text-[11px] outline-none placeholder:text-muted-foreground focus:border-ring [color-scheme:dark]';

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

const FALLBACK_JOB_TYPES: BookableType[] = [
  { id: 'GENERAL_SERVICE', name: 'General Aircon Service', minTier: 1, difficulty: 1, defaultMinutes: 60, slaHours: 48, brandSensitive: false, createdAt: '', certs: [] },
  { id: 'CHEMICAL_WASH', name: 'Chemical Wash', minTier: 1, difficulty: 1, defaultMinutes: 90, slaHours: 72, brandSensitive: false, createdAt: '', certs: [] },
  { id: 'WATER_LEAK', name: 'Water Leakage Repair', minTier: 2, difficulty: 2, defaultMinutes: 90, slaHours: 4, brandSensitive: false, createdAt: '', certs: [] },
  { id: 'GAS_TOPUP', name: 'Refrigerant Top-up (R32)', minTier: 2, difficulty: 2, defaultMinutes: 60, slaHours: 24, brandSensitive: false, createdAt: '', certs: ['NEA_R32'] },
  { id: 'INSTALLATION', name: 'New Unit Installation', minTier: 2, difficulty: 3, defaultMinutes: 180, slaHours: 168, brandSensitive: false, createdAt: '', certs: ['NITEC_HVAC'] },
  { id: 'CRITICAL_HVAC_ELECTRICAL', name: 'Critical HVAC + electrical', minTier: 3, difficulty: 5, defaultMinutes: 90, slaHours: 2, brandSensitive: true, createdAt: '', certs: ['NITEC_HVAC', 'NEA_R32'] },
];

export function JobImportView({
  onCancel,
  onImported,
}: {
  onCancel: () => void;
  onImported: () => void;
}) {
  const [candidates, setCandidates] = useState<JobCandidateRow[] | null>(null);
  const [parseMeta, setParseMeta] = useState<ParseJobsResponse | null>(null);
  const [filename, setFilename] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobTypes, setJobTypes] = useState<BookableType[]>(FALLBACK_JOB_TYPES);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    deskApi
      .jobTypes()
      .then((types) => {
        if (types && types.length > 0) setJobTypes(types);
      })
      .catch(() => {});
  }, []);

  const downloadTemplate = () => {
    const blob = new Blob([SAMPLE_PERFECT], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jobs_template.csv';
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
      const res = await deskApi.parseJobs(text);
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

  const updateCandidate = (index: number, patch: Partial<JobCandidateRow>) => {
    if (!candidates) return;
    setCandidates((prev) => {
      if (!prev) return prev;
      const copy = [...prev];
      const target = { ...copy[index]!, ...patch };

      // Re-validate fields
      const issues: string[] = [];
      if (!target.customerName.trim()) issues.push('Customer name is required.');

      const cleanPhone = (target.phone || '').trim().replace(/[\s-]/g, '').replace(/^\+?65(?=\d{8}$)/, '');
      if (!/^[3689]\d{7}$/.test(cleanPhone)) {
        issues.push(`Phone must be an 8-digit Singapore number (starts with 3, 6, 8, or 9).`);
      }

      const cluster = /^\d{6}$/.test(target.postalCode) ? clusterForPostal(target.postalCode) : null;
      target.cluster = cluster ? CLUSTER_LABEL[cluster] : null;
      if (!cluster) {
        issues.push(`Postal code "${target.postalCode}" cannot be placed into a Singapore sector.`);
      }

      if (!target.address.trim()) {
        issues.push('Address is required.');
      }

      if (target.windowEnd <= target.windowStart) {
        issues.push(`Window end (${target.windowEnd}) must be later than window start (${target.windowStart}).`);
      } else {
        const [startH, startM] = target.windowStart.split(':').map(Number);
        const [endH, endM] = target.windowEnd.split(':').map(Number);
        const durationMinutes = (endH! * 60 + endM!) - (startH! * 60 + startM!);
        const currentType = jobTypes.find((t) => t.id === target.jobTypeId);
        const requiredMin = currentType?.defaultMinutes ?? 60;
        if (durationMinutes < requiredMin) {
          issues.push(`Window (${durationMinutes}m) is shorter than ${currentType?.name || 'job'} takes (${requiredMin}m).`);
        }
      }

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
      setError('No valid jobs to import. Please correct or delete highlighted rows.');
      return;
    }

    setImporting(true);
    setError(null);

    const bodies: CreateJobBody[] = validRows.map((c) => ({
      customerName: c.customerName.trim(),
      phone: c.phone.trim().replace(/[\s-]/g, '').replace(/^\+?65(?=\d{8}$)/, ''),
      postalCode: c.postalCode.trim(),
      address: c.address.trim(),
      unitNo: c.unitNo?.trim() || undefined,
      jobTypeId: c.jobTypeId,
      priority: c.priority,
      windowStart: c.windowStart,
      windowEnd: c.windowEnd,
      date: c.date,
      note: c.note,
    }));

    try {
      await deskApi.importJobs(bodies);
      onImported();
    } catch (e) {
      setError(e instanceof DeskApiError ? (e.detail ?? e.code) : 'Failed to import jobs.');
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
            <Briefcase className="size-3.5 text-primary" />
            Batch Import Work Orders / Jobs
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Ingest customer service tickets from CSV, Excel (.xlsx), or Apache Parquet (.parquet) files.
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
                    {loading ? 'Reading & classifying jobs...' : 'Click to upload or drag & drop ticket file'}
                  </span>
                  <span className="text-[11px] text-muted-foreground block">
                    Supports .csv, .xlsx, .xls, and .parquet work order exports
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
                  onClick={() => void processText(SAMPLE_PERFECT, 'jobs_perfect.csv')}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-md border border-border bg-background/50 p-2 text-left hover:bg-accent hover:border-primary/50 transition',
                    FOCUS,
                  )}
                >
                  <span className="flex items-center gap-1 text-[11px] font-semibold">
                    <Zap className="size-3 text-emerald-400" />
                    Clean Tickets
                  </span>
                  <span className="text-[10px] text-muted-foreground">Standard 10-column schema</span>
                </button>

                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void processText(SAMPLE_MESSY, 'jobs_messy.csv')}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-md border border-border bg-background/50 p-2 text-left hover:bg-accent hover:border-primary/50 transition',
                    FOCUS,
                  )}
                >
                  <span className="flex items-center gap-1 text-[11px] font-semibold">
                    <Sparkles className="size-3 text-sky-400" />
                    Messy CRM Export
                  </span>
                  <span className="text-[10px] text-muted-foreground">Conversational issues, slots & phone</span>
                </button>

                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void processText(SAMPLE_SCRAMBLED, 'jobs_scrambled.csv')}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-md border border-border bg-background/50 p-2 text-left hover:bg-accent hover:border-primary/50 transition',
                    FOCUS,
                  )}
                >
                  <span className="flex items-center gap-1 text-[11px] font-semibold">
                    <FileText className="size-3 text-amber-400" />
                    Scrambled / Corrupt
                  </span>
                  <span className="text-[10px] text-muted-foreground">Inverted slots & bad postal codes</span>
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
                    <Sparkles className="size-3" /> AI Assistant Classified
                  </span>
                )}
                {filename.toLowerCase().endsWith('.parquet') && (
                  <span className="inline-flex items-center gap-1 rounded bg-purple-500/10 px-2 py-0.5 text-[11px] font-medium text-purple-400 border border-purple-500/20">
                    <Database className="size-3" /> Parquet File
                  </span>
                )}
                <span className="text-[11.5px] font-medium">
                  {candidates.length} {candidates.length === 1 ? 'ticket' : 'tickets'} detected
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
                    <CheckCircle2 className="size-3" />
                    All {validCount} valid
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setCandidates(null);
                    setParseMeta(null);
                    setFilename('');
                  }}
                  className="rounded border px-2 py-0.5 text-[11px] font-medium hover:bg-accent"
                >
                  Upload different file
                </button>
              </div>
            </div>

            {/* Candidates Table */}
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b bg-muted/40 text-[11px] text-muted-foreground">
                    <th className="px-2 py-1.5 w-8">#</th>
                    <th className="px-2 py-1.5 min-w-[130px]">Customer Name</th>
                    <th className="px-2 py-1.5 min-w-[90px]">Phone</th>
                    <th className="px-2 py-1.5 min-w-[110px]">Postal & Sector</th>
                    <th className="px-2 py-1.5 min-w-[160px]">Address & Unit</th>
                    <th className="px-2 py-1.5 min-w-[140px]">Job Type</th>
                    <th className="px-2 py-1.5 min-w-[80px]">Priority</th>
                    <th className="px-2 py-1.5 min-w-[110px]">Window</th>
                    <th className="px-2 py-1.5 min-w-[180px]">Symptoms / Notes</th>
                    <th className="px-2 py-1.5 w-8 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {candidates.map((cand, idx) => (
                    <React.Fragment key={idx}>
                      <tr className={cn('hover:bg-muted/10', !cand.isValid && 'bg-destructive/5')}>
                        <td className="px-2 py-1.5 text-center">
                          {cand.isValid ? (
                            <Check className="size-3.5 text-emerald-400 mx-auto" />
                          ) : (
                            <AlertCircle className="size-3.5 text-destructive mx-auto" />
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="text"
                            value={cand.customerName}
                            onChange={(e) => updateCandidate(idx, { customerName: e.target.value })}
                            className={cn(FIELD, !cand.customerName && 'border-destructive')}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="text"
                            value={cand.phone}
                            onChange={(e) => updateCandidate(idx, { phone: e.target.value })}
                            className={cn(FIELD, !/^[3689]\d{7}$/.test(cand.phone) && 'border-destructive')}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex flex-col gap-0.5">
                            <input
                              type="text"
                              maxLength={6}
                              value={cand.postalCode}
                              onChange={(e) => updateCandidate(idx, { postalCode: e.target.value })}
                              className={cn(FIELD, !cand.cluster && 'border-destructive')}
                            />
                            {cand.cluster ? (
                              <span className="text-[10px] text-muted-foreground truncate flex items-center gap-0.5">
                                <MapPin className="size-2.5 text-primary flex-none" />
                                {cand.cluster}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="grid grid-cols-3 gap-1">
                            <input
                              type="text"
                              placeholder="Address"
                              value={cand.address}
                              onChange={(e) => updateCandidate(idx, { address: e.target.value })}
                              className={cn(FIELD, 'col-span-2')}
                            />
                            <input
                              type="text"
                              placeholder="#01-01"
                              value={cand.unitNo || ''}
                              onChange={(e) => updateCandidate(idx, { unitNo: e.target.value })}
                              className={FIELD}
                            />
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            value={cand.jobTypeId}
                            onChange={(e) => updateCandidate(idx, { jobTypeId: e.target.value })}
                            className={FIELD}
                          >
                            {jobTypes.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            value={cand.priority}
                            onChange={(e) =>
                              updateCandidate(idx, { priority: e.target.value as CreateJobBody['priority'] })
                            }
                            className={FIELD}
                          >
                            <option value="urgent">Urgent</option>
                            <option value="on_demand">Normal</option>
                            <option value="when_available">When free</option>
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            <input
                              type="time"
                              value={cand.windowStart}
                              onChange={(e) => updateCandidate(idx, { windowStart: e.target.value })}
                              className={FIELD}
                            />
                            <span className="text-muted-foreground">-</span>
                            <input
                              type="time"
                              value={cand.windowEnd}
                              onChange={(e) => updateCandidate(idx, { windowEnd: e.target.value })}
                              className={FIELD}
                            />
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="text"
                            placeholder="Complaint notes..."
                            value={cand.note || ''}
                            onChange={(e) => updateCandidate(idx, { note: e.target.value })}
                            className={FIELD}
                          />
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => removeCandidate(idx)}
                            className="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition"
                            title="Remove row"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </td>
                      </tr>
                      {/* Issues and notices diagnostics row */}
                      {cand.issues.length > 0 || cand.notices.length > 0 ? (
                        <tr className="bg-muted/10 text-[10.5px]">
                          <td colSpan={10} className="px-3 py-1 border-b border-border/40">
                            <div className="flex flex-wrap items-center gap-2">
                              {cand.issues.map((iss, iIdx) => (
                                <span key={iIdx} className="inline-flex items-center gap-1 text-destructive font-medium">
                                  <AlertCircle className="size-2.5" /> {iss}
                                </span>
                              ))}
                              {cand.notices.map((not, nIdx) => (
                                <span key={nIdx} className="inline-flex items-center gap-1 text-sky-400">
                                  <Sparkles className="size-2.5" /> {not}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Bottom Actions */}
            <div className="flex items-center justify-between border-t pt-3">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-accent"
              >
                Cancel
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={importing || validCount === 0}
                  onClick={() => void handleConfirmImport()}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow hover:bg-primary/90 transition disabled:opacity-50',
                    FOCUS,
                  )}
                >
                  {importing ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Briefcase className="size-3.5" />
                  )}
                  {validCount === 0
                    ? 'No valid jobs to book'
                    : `Confirm Batch Booking (${validCount} ${validCount === 1 ? 'job' : 'jobs'})`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
