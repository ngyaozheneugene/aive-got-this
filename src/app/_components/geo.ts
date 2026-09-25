// Display-only geography for the desk map. These coordinates never reach the
// scheduler: travel times come from the backend's cluster matrix, and the map
// only draws where things are. Geocoded once, offline, from OneMap's search API
// (26 Sep 2026) using the Eastwind fixture's postal codes; where the fixture
// address names a different street than the postal code resolves to, the
// street's coordinates are used so the pin matches the label on the board.

export interface LatLng {
  lat: number;
  lng: number;
}

export const SITE_COORDS: Record<string, LatLng> = {
  '048616': { lat: 1.284350, lng: 103.851073 }, // 1 Raffles Place
  '760123': { lat: 1.434573, lng: 103.831797 }, // Yishun
  '768019': { lat: 1.427903, lng: 103.836178 }, // Northpoint Drive
  '460001': { lat: 1.320852, lng: 103.933721 }, // Bedok
  '460088': { lat: 1.337019, lng: 103.921577 }, // Bedok Reservoir Rd
  '469662': { lat: 1.326864, lng: 103.932130 }, // Eastwood / Bedok North
  '529510': { lat: 1.352527, lng: 103.944699 }, // Tampines
  '528523': { lat: 1.353134, lng: 103.940408 }, // Tampines Walk
  '640441': { lat: 1.353137, lng: 103.721579 }, // Jurong West St 42
  '609601': { lat: 1.325230, lng: 103.748957 }, // International Business Park
  '120440': { lat: 1.316232, lng: 103.763939 }, // Clementi Ave 3
  '048619': { lat: 1.281085, lng: 103.847820 }, // Telok Ayer St
};

/** Where a technician starts the day, by the cluster the backend reports. */
export const CLUSTER_COORDS: Record<string, LatLng> = {
  cbd: { lat: 1.2795, lng: 103.8385 },
  east: { lat: 1.3445, lng: 103.9560 },
  west: { lat: 1.3335, lng: 103.7420 },
  north: { lat: 1.4185, lng: 103.8395 },
  bedok: { lat: 1.3190, lng: 103.9440 },
  northeast: { lat: 1.3868, lng: 103.8914 },
};

/** Map window: all of the island the Eastwind day touches, with a margin. */
export const MAP_BOUNDS = { north: 1.462, south: 1.248, west: 103.675, east: 104.0 } as const;
export const TILE_URL = 'https://www.onemap.gov.sg/maps/tiles/Grey/{z}/{x}/{y}.png';
/** OneMap's terms require their logo and SLA credit on every map. */
export const TILE_ATTRIBUTION =
  '<img src="https://www.onemap.gov.sg/web-assets/images/logo/om_logo.png" alt="" style="height:16px;width:16px;vertical-align:middle"/>&nbsp;' +
  '<a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener noreferrer">OneMap</a>&nbsp;&copy;&nbsp;contributors&nbsp;&#124;&nbsp;' +
  '<a href="https://www.sla.gov.sg/" target="_blank" rel="noopener noreferrer">Singapore Land Authority</a>';

/**
 * Minutes since midnight, read from the wall-clock digits of an ISO string.
 * Product times carry an explicit +08:00 offset, so the HH:MM in the string is
 * already Singapore time. `Date#getHours` would use the viewer's timezone.
 */
export function minutesOfDay(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** One colour per technician, stable across the timeline and the map. */
const TECH_PALETTE = ['#16325c', '#1b7a74', '#7b3f8c', '#b07a12', '#4d6fa8', '#3d7a3a'];

export function techColor(technicianIds: string[], technicianId: string | undefined): string {
  if (!technicianId) return '#8c2f21';
  const i = technicianIds.indexOf(technicianId);
  return TECH_PALETTE[(i < 0 ? 0 : i) % TECH_PALETTE.length]!;
}
