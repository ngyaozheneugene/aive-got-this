import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as parseDraft } from './import/draft/route';
import { POST as bulkCreate } from './bulk/route';
import { GET as getTeam } from './route';

const req = (path: string, init: { method?: string; workspace?: string; body?: unknown } = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method: init.method ?? 'GET',
    headers: { ...(init.workspace ? { 'x-workspace': init.workspace } : {}), 'content-type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

describe('Technician bulk creation and draft parsing routes', () => {
  it('parses CSV input through draft endpoint', async () => {
    const csv = `name,tier,homePostalCode,certs,parts,maxHoursDay,acceptsOt
Alice,2,520123,WSH_PASS,inverter_board,8,true
Bob,3,048581,NEA_R32:2028-01-01,,8,false`;

    const res = await parseDraft(req('/api/technicians/import/draft', { method: 'POST', body: { text: csv } }));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.source).toBe('template_fast_path');
    expect(data.totalRows).toBe(2);
    expect(data.validCount).toBe(2);
    expect(data.candidates[0].name).toBe('Alice');
    expect(data.candidates[0].cluster).toBe('East (Tampines, Pasir Ris, Changi)');
    expect(data.candidates[1].name).toBe('Bob');
    expect(data.candidates[1].cluster).toBe('CBD');
  });

  it('parses Parquet binary upload through draft endpoint with fileBase64', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const parquetBuffer = fs.readFileSync(
      path.resolve(process.cwd(), 'sample-imports', 'technicians_perfect.parquet'),
    );
    const fileBase64 = parquetBuffer.toString('base64');

    const res = await parseDraft(
      req('/api/technicians/import/draft', {
        method: 'POST',
        body: { fileBase64, filename: 'technicians_perfect.parquet' },
      }),
    );
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.source).toBe('template_fast_path');
    expect(data.totalRows).toBe(5);
    expect(data.validCount).toBe(5);
    expect(data.candidates[0].name).toBe('Tan Wei');
    expect(data.candidates[0].cluster).toBe('CBD');
  });

  it('bulk creates technicians in workspace', async () => {
    const beforeTeam = await (await getTeam(req('/api/technicians', { workspace: 'live' }))).json();
    const beforeCount = beforeTeam.length;

    const technicians = [
      { name: 'Bulk Tech 1', tier: 1, homePostalCode: '048581', certs: [], parts: [], acceptsOt: false, maxMinutesDay: 480 },
      { name: 'Bulk Tech 2', tier: 3, homePostalCode: '520123', certs: [{ type: 'NEA_R32' }], parts: ['inverter_board'], acceptsOt: true, maxMinutesDay: 480 },
    ];

    const bulkRes = await bulkCreate(
      req('/api/technicians/bulk', { method: 'POST', workspace: 'live', body: { technicians } }),
    );
    expect(bulkRes.status).toBe(201);
    const bulkData = await bulkRes.json();
    expect(bulkData.ok).toBe(true);
    expect(bulkData.created).toBe(2);

    // Verify team listing grew by 2
    const afterTeam = await (await getTeam(req('/api/technicians', { workspace: 'live' }))).json();
    expect(afterTeam).toHaveLength(beforeCount + 2);
    expect(afterTeam.map((t: { name: string }) => t.name)).toContain('Bulk Tech 1');
    expect(afterTeam.map((t: { name: string }) => t.name)).toContain('Bulk Tech 2');
  });

  it('fails bulk creation atomically if invalid postal code is provided', async () => {
    const beforeTeam = await (await getTeam(req('/api/technicians', { workspace: 'live' }))).json();
    const beforeCount = beforeTeam.length;

    const technicians = [
      { name: 'Valid Tech', tier: 1, homePostalCode: '048581', certs: [], parts: [], acceptsOt: false, maxMinutesDay: 480 },
      { name: 'Bad Tech', tier: 2, homePostalCode: '999999', certs: [], parts: [], acceptsOt: false, maxMinutesDay: 480 },
    ];

    const bulkRes = await bulkCreate(
      req('/api/technicians/bulk', { method: 'POST', workspace: 'live', body: { technicians } }),
    );
    expect(bulkRes.status).toBe(422);

    // Verify count did not change
    const afterTeam = await (await getTeam(req('/api/technicians', { workspace: 'live' }))).json();
    expect(afterTeam).toHaveLength(beforeCount);
  });
});
