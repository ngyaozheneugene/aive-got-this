// Singapore postal code to travel cluster.
//
// The first two digits of a six-digit postal code are its sector, and every
// sector belongs to one of the 28 postal districts. Each district maps to the
// cluster whose drive times it shares on the travel matrix. Coarse but stable:
// it needs no network call and never changes under a running demo. Imports
// nothing, so the desk can show the area as the coordinator types.

export type Cluster = 'cbd' | 'south' | 'central' | 'east' | 'bedok' | 'northeast' | 'north' | 'west';

/** The region label a site carries, by cluster. */
export const CLUSTER_REGION: Record<Cluster, string> = {
  cbd: 'Central',
  south: 'Central',
  central: 'Central',
  east: 'East',
  bedok: 'East',
  northeast: 'North-East',
  north: 'North',
  west: 'West',
};

/** Human label for the desk. */
export const CLUSTER_LABEL: Record<Cluster, string> = {
  cbd: 'CBD',
  south: 'South (HarbourFront, Bukit Merah)',
  central: 'Central (Novena, Toa Payoh, Bishan)',
  east: 'East (Tampines, Pasir Ris, Changi)',
  bedok: 'Bedok and the East Coast',
  northeast: 'North-East (Hougang, Sengkang, Punggol)',
  north: 'North (Woodlands, Yishun)',
  west: 'West (Jurong, Clementi)',
};

// Sector ranges by district, inclusive. URA postal districts.
const SECTORS: Array<[from: number, to: number, cluster: Cluster]> = [
  [1, 8, 'cbd'], // D1-D2 Raffles Place, Marina, Tanjong Pagar, Chinatown
  [9, 10, 'south'], // D4 HarbourFront, Telok Blangah, Sentosa
  [11, 13, 'west'], // D5 Pasir Panjang, Clementi, West Coast
  [14, 16, 'south'], // D3 Queenstown, Tiong Bahru, Bukit Merah
  [17, 17, 'cbd'], // D6 High Street, Beach Road
  [18, 19, 'cbd'], // D7 Middle Road, Golden Mile
  [20, 21, 'central'], // D8 Little India, Farrer Park
  [22, 23, 'central'], // D9 Orchard, River Valley
  [24, 27, 'central'], // D10 Bukit Timah, Holland, Tanglin
  [28, 30, 'central'], // D11 Watten, Novena, Thomson
  [31, 33, 'central'], // D12 Balestier, Toa Payoh
  [34, 37, 'central'], // D13 Macpherson, Braddell
  [38, 41, 'bedok'], // D14 Geylang, Eunos
  [42, 45, 'bedok'], // D15 Katong, Joo Chiat, Marine Parade
  [46, 48, 'bedok'], // D16 Bedok, Upper East Coast
  [49, 50, 'east'], // D17 Loyang, Changi
  [51, 52, 'east'], // D18 Tampines, Pasir Ris
  [53, 55, 'northeast'], // D19 Serangoon Garden, Hougang
  [56, 57, 'central'], // D20 Bishan, Ang Mo Kio
  [58, 59, 'west'], // D21 Upper Bukit Timah, Clementi Park
  [60, 64, 'west'], // D22 Jurong, Boon Lay
  [65, 68, 'west'], // D23 Bukit Batok, Bukit Panjang, Choa Chu Kang
  [69, 71, 'west'], // D24 Lim Chu Kang, Tengah
  [72, 73, 'north'], // D25 Kranji, Woodlands
  [75, 76, 'north'], // D27 Yishun, Sembawang
  [77, 78, 'north'], // D26 Upper Thomson, Springleaf
  [79, 80, 'northeast'], // D28 Seletar, Yio Chu Kang
  [81, 81, 'east'], // D17 Changi
  [82, 82, 'northeast'], // D19 Punggol, Sengkang
];

export function isPostalCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}

/** The cluster for a postal code, or null when it is not a Singapore code we can place. */
export function clusterForPostal(postalCode: string): Cluster | null {
  if (!isPostalCode(postalCode)) return null;
  const sector = Number(postalCode.slice(0, 2));
  return SECTORS.find(([from, to]) => sector >= from && sector <= to)?.[2] ?? null;
}
