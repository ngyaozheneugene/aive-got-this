import { describe, expect, it } from 'vitest';
import { InMemoryDatabase } from './index';
import { EASTWIND } from '../../shared/fixtures/eastwind';

describe('Eastwind Tuesday fixture', () => {
  it('paints six technicians and twelve jobs', async () => {
    const db = new InMemoryDatabase();
    const techs = await db.technicians.listAll();
    const jobs = await db.jobs.listByScheduledDate(EASTWIND.date);
    expect(techs).toHaveLength(6);
    expect(jobs).toHaveLength(12);
  });

  it('keeps Wei as the nearest illegal van for Raffles Place', async () => {
    const db = new InMemoryDatabase();
    const wei = await db.technicians.getById('tech_wei');
    const raffles = await db.jobs.getById('job_raffles');
    const site = raffles ? await db.sites.getById(raffles.siteId) : null;
    expect(wei?.currentCluster).toBe('cbd');
    expect(site?.estateCluster).toBe('cbd');
    expect(raffles?.status).toBe('unassigned');
    expect(await db.technicians.certValidOn('tech_wei', 'NEA_R32', EASTWIND.date)).toBe(false);
  });

  it('has a promised SLA and an in-progress job', async () => {
    const db = new InMemoryDatabase();
    const sla = await db.jobs.getById('job_mei_sla');
    const running = await db.jobs.getById('job_hafiz_1');
    expect(sla?.lockState).toBe('promised');
    expect(running?.lockState).toBe('in_progress');
    expect(running?.status).toBe('on_site');
  });

  it('covers travel from Wei to Raffles', async () => {
    const db = new InMemoryDatabase();
    await expect(db.travelMatrix.getTravelMinutes('cbd', 'cbd')).resolves.toBe(8);
  });
});
