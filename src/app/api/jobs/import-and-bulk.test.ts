import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as parseDraft } from './import/draft/route';
import { POST as bulkCreate } from './bulk/route';
import { getDatabase } from '../../../db';

const req = (path: string, init: { method?: string; workspace?: string; body?: unknown } = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method: init.method ?? 'GET',
    headers: { ...(init.workspace ? { 'x-workspace': init.workspace } : {}), 'content-type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

describe('Job bulk creation and draft parsing routes', () => {
  it('parses CSV input through draft endpoint', async () => {
    const csv = `customerName,phone,postalCode,address,unitNo,jobTypeId,priority,windowStart,windowEnd,note
Tan Corp,91234567,048616,1 Raffles Place,#10-01,WATER_LEAK,urgent,09:00,12:00,Ceiling pipe leak
Lee Clinic,82345678,520123,Simei St 1,,GENERAL_SERVICE,on_demand,14:00,16:30,Check filter`;

    const res = await parseDraft(req('/api/jobs/import/draft', { method: 'POST', body: { text: csv } }));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.source).toBe('template_fast_path');
    expect(data.totalRows).toBe(2);
    expect(data.validCount).toBe(2);
    expect(data.candidates[0].customerName).toBe('Tan Corp');
    expect(data.candidates[0].cluster).toBe('CBD');
    expect(data.candidates[1].customerName).toBe('Lee Clinic');
    expect(data.candidates[1].cluster).toBe('East (Tampines, Pasir Ris, Changi)');
  });

  it('parses Parquet binary upload through draft endpoint with fileBase64', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const parquetBuffer = fs.readFileSync(
      path.resolve(process.cwd(), 'sample-imports', 'jobs_perfect.parquet'),
    );
    const fileBase64 = parquetBuffer.toString('base64');

    const res = await parseDraft(
      req('/api/jobs/import/draft', {
        method: 'POST',
        body: { fileBase64, filename: 'jobs_perfect.parquet' },
      }),
    );
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.source).toBe('template_fast_path');
    expect(data.totalRows).toBe(5);
    expect(data.validCount).toBe(5);
    expect(data.candidates[0].customerName).toBe('Raffles Place Capital');
    expect(data.candidates[0].cluster).toBe('CBD');
  });

  it('bulk creates jobs in workspace with atomic transaction', async () => {
    const db = getDatabase('live');
    const beforeJobs = await db.jobs.listUnassigned();
    const beforeCount = beforeJobs.length;

    const jobs = [
      {
        customerName: 'Batch Customer 1',
        phone: '98765432',
        postalCode: '048616',
        address: '1 Raffles Place',
        jobTypeId: 'WATER_LEAK',
        priority: 'urgent' as const,
        windowStart: '09:00',
        windowEnd: '12:00',
        note: 'Emergency leak',
      },
      {
        customerName: 'Batch Customer 1', // same customer phone: deduplicates customer record
        phone: '98765432',
        postalCode: '520123',
        address: 'Simei St 1',
        jobTypeId: 'GENERAL_SERVICE',
        priority: 'on_demand' as const,
        windowStart: '14:00',
        windowEnd: '16:00',
        note: 'Regular servicing',
      },
    ];

    const bulkRes = await bulkCreate(
      req('/api/jobs/bulk', { method: 'POST', workspace: 'live', body: { jobs } }),
    );
    expect(bulkRes.status).toBe(201);
    const bulkData = await bulkRes.json();
    expect(bulkData.ok).toBe(true);
    expect(bulkData.created).toBe(2);

    const afterJobs = await db.jobs.listUnassigned();
    expect(afterJobs).toHaveLength(beforeCount + 2);

    // Verify customer deduplication
    const cust = await db.customers.getByPhone('98765432');
    expect(cust).toBeDefined();
    expect(cust?.name).toBe('Batch Customer 1');
  });

  it('fails bulk creation atomically if invalid postal code is provided', async () => {
    const db = getDatabase('live');
    const beforeJobs = await db.jobs.listUnassigned();
    const beforeCount = beforeJobs.length;

    const jobs = [
      {
        customerName: 'Good Customer',
        phone: '91112222',
        postalCode: '048616',
        address: '1 Raffles Place',
        jobTypeId: 'WATER_LEAK',
        priority: 'urgent' as const,
        windowStart: '09:00',
        windowEnd: '12:00',
      },
      {
        customerName: 'Bad Customer',
        phone: '93334444',
        postalCode: '999999', // Invalid postal code
        address: 'Unknown Street',
        jobTypeId: 'GENERAL_SERVICE',
        priority: 'on_demand' as const,
        windowStart: '14:00',
        windowEnd: '16:00',
      },
    ];

    const bulkRes = await bulkCreate(
      req('/api/jobs/bulk', { method: 'POST', workspace: 'live', body: { jobs } }),
    );
    expect(bulkRes.status).toBe(422);

    // Verify count did not change (ACID rollback)
    const afterJobs = await db.jobs.listUnassigned();
    expect(afterJobs).toHaveLength(beforeCount);
  });
});
