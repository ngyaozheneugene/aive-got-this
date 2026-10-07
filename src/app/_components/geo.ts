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
  // Finals board (src/shared/fixtures/scenario.ts). Placed by hand at the
  // street each site names, to roughly street accuracy: OneMap's search rate
  // limit stopped a scripted pass. Display only, like everything in this file.
  '018983': { lat: 1.279900, lng: 103.854300 }, // 8 Marina Blvd
  '058357': { lat: 1.283600, lng: 103.844500 }, // Pagoda St
  '068809': { lat: 1.276600, lng: 103.847800 }, // Shenton Way
  '098585': { lat: 1.264400, lng: 103.822200 }, // 1 HarbourFront Walk
  '150123': { lat: 1.285300, lng: 103.809000 }, // Bukit Merah View
  '168732': { lat: 1.284600, lng: 103.831700 }, // Seng Poh Rd
  '099253': { lat: 1.270800, lng: 103.816800 }, // Telok Blangah Rd
  '310123': { lat: 1.338300, lng: 103.845800 }, // Toa Payoh Lor 1
  '307683': { lat: 1.320400, lng: 103.843800 }, // Thomson Rd, Novena
  '570123': { lat: 1.347400, lng: 103.852600 }, // Bishan St 13
  '570456': { lat: 1.359200, lng: 103.846200 }, // Bishan St 22
  '518123': { lat: 1.374500, lng: 103.949300 }, // Pasir Ris Rd
  '520123': { lat: 1.344600, lng: 103.953200 }, // Simei St 1
  '519456': { lat: 1.378000, lng: 103.942000 }, // Pasir Ris Dr 3
  '521789': { lat: 1.356700, lng: 103.951200 }, // Tampines St 21
  '467360': { lat: 1.324800, lng: 103.929300 }, // New Upper Changi Rd
  '530123': { lat: 1.355400, lng: 103.888800 }, // Hougang Ave 1
  '545078': { lat: 1.383600, lng: 103.891500 }, // Compassvale St
  '828123': { lat: 1.402200, lng: 103.905600 }, // Punggol Field
  '538456': { lat: 1.370000, lng: 103.892000 }, // Hougang St 51
  '540789': { lat: 1.391700, lng: 103.899600 }, // Sengkang East Way
  '738099': { lat: 1.436000, lng: 103.786300 }, // Woodlands Square
  '730123': { lat: 1.431400, lng: 103.774500 }, // Woodlands Dr 14
  '769098': { lat: 1.430700, lng: 103.844300 }, // Yishun Ave 11
  '608549': { lat: 1.333100, lng: 103.742200 }, // Jurong Gateway Rd
  '640789': { lat: 1.339800, lng: 103.687800 }, // Jurong West St 91
  '129588': { lat: 1.308000, lng: 103.772000 }, // Clementi Rd
};

/** Where a technician starts the day, by the cluster the backend reports. */
export const CLUSTER_COORDS: Record<string, LatLng> = {
  cbd: { lat: 1.2795, lng: 103.8385 },
  east: { lat: 1.3445, lng: 103.9560 },
  west: { lat: 1.3335, lng: 103.7420 },
  north: { lat: 1.4185, lng: 103.8395 },
  bedok: { lat: 1.3190, lng: 103.9440 },
  northeast: { lat: 1.3868, lng: 103.8914 },
  south: { lat: 1.2760, lng: 103.8200 },
  central: { lat: 1.3420, lng: 103.8480 },
};

/** Map window: all of the island the Eastwind day touches, with a margin. */
export const MAP_BOUNDS = { north: 1.462, south: 1.248, west: 103.675, east: 104.0 } as const;
export const TILE_URL = 'https://www.onemap.gov.sg/maps/tiles/Night/{z}/{x}/{y}.png';
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
// Fifteen hues, one per technician on the finals board. Red is kept for
// unassigned work, so nothing here is close to #ef4444.
const TECH_PALETTE = [
  '#3b82f6', '#14b8a6', '#a855f7', '#f59e0b', '#ec4899',
  '#22c55e', '#06b6d4', '#f97316', '#6366f1', '#84cc16',
  '#d946ef', '#eab308', '#0ea5e9', '#10b981', '#c084fc',
];

export function techColor(technicianIds: string[], technicianId: string | undefined): string {
  if (!technicianId) return '#ef4444';
  const i = technicianIds.indexOf(technicianId);
  return TECH_PALETTE[(i < 0 ? 0 : i) % TECH_PALETTE.length]!;
}
