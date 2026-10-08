import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as reset } from './demo/reset/route';
import { GET as schedule } from './schedule/current/route';
import { POST as addTechnician } from './technicians/route';

const req = (path: string, init: { method?: string; workspace?: string; body?: unknown } = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method: init.method ?? 'GET',
    headers: { ...(init.workspace ? { 'x-workspace': init.workspace } : {}), 'content-type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

describe('workspaces through the routes', () => {
  it('refuses a reset anywhere but the simulation', async () => {
    const refused = await reset(req('/api/demo/reset', { method: 'POST' }));
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toBe('reset_simulation_only');
    expect((await reset(req('/api/demo/reset', { method: 'POST', workspace: 'live' }))).status).toBe(403);
    expect((await reset(req('/api/demo/reset', { method: 'POST', workspace: 'simulation' }))).status).toBe(200);
  });

  it('keeps what one workspace writes out of the other', async () => {
    const count = async (workspace?: string) =>
      ((await (await schedule(req('/api/schedule/current', { workspace }))).json()) as { technicians: unknown[] }).technicians.length;
    const before = { live: await count('live'), simulation: await count('simulation') };
    const added = await addTechnician(req('/api/technicians', {
      method: 'POST', workspace: 'live', body: { name: 'Real person', tier: 2, homePostalCode: '520123' },
    }));
    expect(added.status).toBe(201);
    expect(await count('live')).toBe(before.live + 1);
    expect(await count()).toBe(before.live + 1); // no header: the company's own
    expect(await count('simulation')).toBe(before.simulation);
  });
});
