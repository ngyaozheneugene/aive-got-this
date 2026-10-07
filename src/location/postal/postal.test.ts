import { describe, expect, it } from 'vitest';
import { clusterForPostal, CLUSTER_REGION } from './index';
import { buildScenario } from '../../shared/fixtures/scenario';
import { EASTWIND } from '../../shared/fixtures/eastwind';

describe('clusterForPostal', () => {
  it('agrees with every seeded site, on both boards', () => {
    for (const site of [...buildScenario('2026-10-20').sites, ...EASTWIND.sites]) {
      expect(clusterForPostal(site.postalCode), `${site.id} ${site.postalCode}`).toBe(site.estateCluster);
      expect(CLUSTER_REGION[clusterForPostal(site.postalCode)!], site.id).toBe(site.region);
    }
  });

  it('places well-known addresses', () => {
    expect(clusterForPostal('018989')).toBe('cbd'); // Marina Bay
    expect(clusterForPostal('238859')).toBe('central'); // Orchard
    expect(clusterForPostal('819663')).toBe('east'); // Changi Airport
    expect(clusterForPostal('828761')).toBe('northeast'); // Punggol
    expect(clusterForPostal('639798')).toBe('west'); // Jurong
  });

  it('refuses what it cannot place', () => {
    expect(clusterForPostal('12345')).toBeNull();
    expect(clusterForPostal('abcdef')).toBeNull();
    expect(clusterForPostal('740000')).toBeNull(); // sector 74 is unused
    expect(clusterForPostal('990000')).toBeNull();
  });
});
