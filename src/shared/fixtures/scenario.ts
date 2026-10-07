// The finals scenario: Eastwind Aircon as a mid-sized Singapore HVAC firm.
//
// The 12-job Eastwind fixture (eastwind.ts) stays the unit-test board: small,
// fixed date, known answers. This is the board the live desk runs on. It is
// dated from the day it is seeded, so the desk always shows "today", and it is
// big enough that the solver has real trade-offs to make.
//
// The demo stories keep their IDs and shape:
//   - job_raffles: urgent, 13:00-17:00, needs tier 3 + HVAC + R32 and the
//     inverter board, which only Siti (nearer) and Jonah (more room) carry.
//     Marcus, nearer still, is qualified but has no inverter board.
//   - tech_hafiz: on site at Bedok North since 08:00 (job_hafiz_1), then 11:00
//     and 14:00. A 90-minute overrun collides with the 11:00; 45 is absorbed.
//   - job_mei_sla: Northpoint Medical's promised 14:00 window, locked.
//
// Every job carries a requirement row derived from its job type, because Stage A
// only checks tier and certificates through those rows. Every booked slot is
// start + duration inside the customer's window, and consecutive slots leave at
// least the off-peak drive between clusters, so the seeded board is legal.

import { SNAPSHOT_V1_ID, addDays } from '../config/demo';
import {
  emptyPlanMetrics,
  type AppUser,
  type Assignment,
  type BoardSnapshot,
  type CertType,
  type Customer,
  type Job,
  type JobLockState,
  type JobPriority,
  type JobRequirement,
  type JobStatus,
  type JobType,
  type JobTypeCert,
  type Shift,
  type Site,
  type Technician,
  type TechnicianCert,
  type TechnicianTier,
  type TravelMatrix,
  type WindowType,
} from '../types/domain';
import type { Scenario } from './eastwind';

export const FINALS_SCENARIO = 'eastwind-finals';

const CLUSTERS = ['cbd', 'south', 'central', 'east', 'bedok', 'northeast', 'north', 'west'] as const;
type Cluster = (typeof CLUSTERS)[number];

// Off-peak and peak drive minutes. The six original pairs match eastwind.ts.
const PAIR_MINUTES: Record<string, [number, number]> = {
  'cbd|east': [22, 34],
  'cbd|west': [30, 46],
  'cbd|north': [35, 52],
  'cbd|northeast': [28, 42],
  'bedok|cbd': [32, 48],
  'east|west': [45, 65],
  'east|north': [35, 50],
  'east|northeast': [20, 30],
  'bedok|east': [15, 25],
  'north|west': [40, 55],
  'northeast|west': [50, 70],
  'bedok|west': [55, 75],
  'north|northeast': [20, 30],
  'bedok|north': [40, 55],
  'bedok|northeast': [25, 38],
  'cbd|central': [18, 28],
  'central|east': [25, 38],
  'central|west': [30, 45],
  'central|north': [22, 32],
  'central|northeast': [18, 28],
  'bedok|central': [25, 38],
  'central|south': [22, 32],
  'cbd|south': [12, 20],
  'east|south': [30, 45],
  'south|west': [22, 35],
  'north|south': [38, 55],
  'northeast|south': [32, 48],
  'bedok|south': [32, 48],
};

const SAME_CLUSTER: [number, number] = [8, 12];

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Off-peak minutes between two clusters, as the validator reads them. */
export function scenarioDriveMinutes(from: Cluster, to: Cluster): number {
  if (from === to) return SAME_CLUSTER[0];
  const pair = PAIR_MINUTES[pairKey(from, to)];
  if (!pair) throw new Error(`no drive time for ${from} -> ${to}`);
  return pair[0];
}

// ---------------------------------------------------------------------------
// Static tables. Nothing here knows the date.

interface TechRow {
  id: string;
  name: string;
  tier: TechnicianTier;
  home: Cluster;
  region: string;
  certs: CertType[];
  /** Certificates on file that lapsed before the board day. */
  expired?: CertType[];
  parts?: string[];
  acceptsOt?: boolean;
}

const TECHS: TechRow[] = [
  { id: 'tech_wei', name: 'Wei', tier: 1, home: 'cbd', region: 'Central', certs: ['WSH_PASS'], expired: ['NEA_R32'] },
  { id: 'tech_siti', name: 'Siti', tier: 3, home: 'east', region: 'East', certs: ['WSH_PASS', 'NITEC_HVAC', 'NEA_R32'], parts: ['inverter_board'] },
  { id: 'tech_kumar', name: 'Kumar', tier: 3, home: 'west', region: 'West', certs: ['WSH_PASS', 'NITEC_HVAC', 'NEA_R32'] },
  { id: 'tech_mei', name: 'Mei', tier: 2, home: 'north', region: 'North', certs: ['WSH_PASS', 'NITEC_HVAC'] },
  { id: 'tech_hafiz', name: 'Hafiz', tier: 2, home: 'bedok', region: 'East', certs: ['WSH_PASS', 'NITEC_HVAC'] },
  { id: 'tech_jonah', name: 'Jonah', tier: 4, home: 'west', region: 'West', certs: ['WSH_PASS', 'NITEC_HVAC', 'NEA_R32', 'EMA_LEW'], parts: ['inverter_board'], acceptsOt: true },
  { id: 'tech_aisha', name: 'Aisha', tier: 3, home: 'central', region: 'Central', certs: ['WSH_PASS', 'NITEC_HVAC', 'NEA_R32'] },
  { id: 'tech_ravi', name: 'Ravi', tier: 2, home: 'northeast', region: 'North-East', certs: ['WSH_PASS', 'NITEC_HVAC', 'NEA_R32'] },
  { id: 'tech_daniel', name: 'Daniel', tier: 1, home: 'south', region: 'Central', certs: ['WSH_PASS'] },
  { id: 'tech_farah', name: 'Farah', tier: 2, home: 'central', region: 'Central', certs: ['WSH_PASS', 'NITEC_HVAC'] },
  { id: 'tech_marcus', name: 'Marcus', tier: 4, home: 'cbd', region: 'Central', certs: ['WSH_PASS', 'NITEC_HVAC', 'NEA_R32', 'EMA_LEW'], acceptsOt: true },
  { id: 'tech_grace', name: 'Grace', tier: 3, home: 'north', region: 'North', certs: ['WSH_PASS', 'NITEC_HVAC', 'NEA_R32'] },
  { id: 'tech_hamid', name: 'Hamid', tier: 2, home: 'west', region: 'West', certs: ['WSH_PASS', 'NITEC_HVAC'] },
  { id: 'tech_lina', name: 'Lina', tier: 1, home: 'northeast', region: 'North-East', certs: ['WSH_PASS'] },
  { id: 'tech_ben', name: 'Ben', tier: 2, home: 'east', region: 'East', certs: ['WSH_PASS', 'NITEC_HVAC'], expired: ['NEA_R32'] },
];

const LEGAL_GATES: CertType[] = ['NEA_R32', 'BCA_STRUCTURAL', 'EMA_LEW'];

interface JobTypeRow {
  id: string;
  name: string;
  minTier: TechnicianTier;
  minutes: number;
  slaHours: number;
  difficulty: number;
  certs: CertType[];
  brandSensitive?: boolean;
}

const JOB_TYPES: JobTypeRow[] = [
  { id: 'GENERAL_SERVICE', name: 'General Aircon Service', minTier: 1, minutes: 60, slaHours: 48, difficulty: 1, certs: [] },
  { id: 'CHEMICAL_WASH', name: 'Chemical Wash', minTier: 1, minutes: 90, slaHours: 72, difficulty: 1, certs: [] },
  { id: 'WATER_LEAK', name: 'Water Leakage Repair', minTier: 2, minutes: 90, slaHours: 4, difficulty: 2, certs: [] },
  { id: 'GAS_TOPUP', name: 'Refrigerant Top-up (R32)', minTier: 2, minutes: 60, slaHours: 24, difficulty: 2, certs: ['NEA_R32'] },
  { id: 'INSTALLATION', name: 'New Unit Installation', minTier: 2, minutes: 180, slaHours: 168, difficulty: 3, certs: ['NITEC_HVAC'] },
  {
    id: 'CRITICAL_HVAC_ELECTRICAL',
    name: 'Critical HVAC + electrical (scarce cert + carried part)',
    minTier: 3,
    minutes: 90,
    slaHours: 2,
    difficulty: 5,
    certs: ['NITEC_HVAC', 'NEA_R32'],
    brandSensitive: true,
  },
];

interface SiteRow {
  id: string;
  customerId: string;
  customer: string;
  company?: string;
  postal: string;
  cluster: Cluster;
  region: string;
  address: string;
}

const SITES: SiteRow[] = [
  // cbd
  { id: 'site_raffles', customerId: 'cust_raffles', customer: 'Raffles Place Capital', company: 'RPC Pte Ltd', postal: '048616', cluster: 'cbd', region: 'Central', address: '1 Raffles Place' },
  { id: 'site_wei_1', customerId: 'cust_wei', customer: 'Telok Ayer Walk-up', postal: '048619', cluster: 'cbd', region: 'Central', address: 'Telok Ayer St' },
  { id: 'site_mbfc', customerId: 'cust_mbfc', customer: 'Marina Bay Offices', company: 'MBO Management', postal: '018983', cluster: 'cbd', region: 'Central', address: '8 Marina Blvd' },
  { id: 'site_chinatown', customerId: 'cust_pagoda', customer: 'Pagoda Street Shophouse', postal: '058357', cluster: 'cbd', region: 'Central', address: 'Pagoda St' },
  { id: 'site_shenton', customerId: 'cust_mbfc', customer: 'Marina Bay Offices', company: 'MBO Management', postal: '068809', cluster: 'cbd', region: 'Central', address: 'Shenton Way' },
  // south
  { id: 'site_vivo', customerId: 'cust_vivo', customer: 'HarbourFront Retail', company: 'HFR Pte Ltd', postal: '098585', cluster: 'south', region: 'Central', address: '1 HarbourFront Walk' },
  { id: 'site_bukit_merah', customerId: 'cust_lim', customer: 'Lim Household', postal: '150123', cluster: 'south', region: 'Central', address: 'Bukit Merah View' },
  { id: 'site_tiong_bahru', customerId: 'cust_tb', customer: 'Tiong Bahru Bakery Row', postal: '168732', cluster: 'south', region: 'Central', address: 'Seng Poh Rd' },
  { id: 'site_harbour', customerId: 'cust_vivo', customer: 'HarbourFront Retail', company: 'HFR Pte Ltd', postal: '099253', cluster: 'south', region: 'Central', address: 'Telok Blangah Rd' },
  // central
  { id: 'site_toa_payoh', customerId: 'cust_ng', customer: 'Ng Household', postal: '310123', cluster: 'central', region: 'Central', address: 'Toa Payoh Lor 1' },
  { id: 'site_novena', customerId: 'cust_novena', customer: 'Novena Specialist Centre', company: 'NSC', postal: '307683', cluster: 'central', region: 'Central', address: 'Thomson Rd' },
  { id: 'site_bishan', customerId: 'cust_bishan', customer: 'Bishan Park Condo MCST', postal: '570123', cluster: 'central', region: 'Central', address: 'Bishan St 13' },
  { id: 'site_bishan_2', customerId: 'cust_chua', customer: 'Chua Household', postal: '570456', cluster: 'central', region: 'Central', address: 'Bishan St 22' },
  // east
  { id: 'site_siti_1', customerId: 'cust_siti', customer: 'Tampines Hub', postal: '529510', cluster: 'east', region: 'East', address: 'Tampines Walk' },
  { id: 'site_siti_2', customerId: 'cust_siti', customer: 'Tampines Hub', postal: '528523', cluster: 'east', region: 'East', address: 'Tampines Ave 5' },
  { id: 'site_pasir_ris', customerId: 'cust_pr', customer: 'Pasir Ris Chalets', postal: '518123', cluster: 'east', region: 'East', address: 'Pasir Ris Rd' },
  { id: 'site_simei', customerId: 'cust_tan', customer: 'Tan Household (Simei)', postal: '520123', cluster: 'east', region: 'East', address: 'Simei St 1' },
  { id: 'site_pasir_ris_2', customerId: 'cust_pr', customer: 'Pasir Ris Chalets', postal: '519456', cluster: 'east', region: 'East', address: 'Pasir Ris Dr 3' },
  { id: 'site_tampines_3', customerId: 'cust_goh', customer: 'Goh Household', postal: '521789', cluster: 'east', region: 'East', address: 'Tampines St 21' },
  // bedok
  { id: 'site_hafiz_1', customerId: 'cust_hafiz', customer: 'Bedok Residences', postal: '460001', cluster: 'bedok', region: 'East', address: 'Bedok North St 1' },
  { id: 'site_hafiz_2', customerId: 'cust_hafiz', customer: 'Bedok Residences', postal: '460088', cluster: 'bedok', region: 'East', address: 'Bedok Reservoir Rd' },
  { id: 'site_hafiz_3', customerId: 'cust_hafiz', customer: 'Bedok Residences', postal: '469662', cluster: 'bedok', region: 'East', address: 'Eastwood Centre' },
  { id: 'site_bedok_mall', customerId: 'cust_bm', customer: 'Bedok Mall Tenants', company: 'BMT', postal: '467360', cluster: 'bedok', region: 'East', address: 'New Upper Changi Rd' },
  // northeast
  { id: 'site_hougang', customerId: 'cust_koh', customer: 'Koh Household', postal: '530123', cluster: 'northeast', region: 'North-East', address: 'Hougang Ave 1' },
  { id: 'site_sengkang', customerId: 'cust_sk', customer: 'Sengkang Grand Mall', company: 'SGM', postal: '545078', cluster: 'northeast', region: 'North-East', address: 'Compassvale St' },
  { id: 'site_punggol', customerId: 'cust_pg', customer: 'Punggol Waterway Condo', postal: '828123', cluster: 'northeast', region: 'North-East', address: 'Punggol Field' },
  { id: 'site_hougang_2', customerId: 'cust_wong', customer: 'Wong Household', postal: '538456', cluster: 'northeast', region: 'North-East', address: 'Hougang St 51' },
  { id: 'site_sengkang_2', customerId: 'cust_lee', customer: 'Lee Household', postal: '540789', cluster: 'northeast', region: 'North-East', address: 'Sengkang East Way' },
  // north
  { id: 'site_mei_am', customerId: 'cust_mei_am', customer: 'Tan Household', postal: '760123', cluster: 'north', region: 'North', address: 'Yishun Ave 2' },
  { id: 'site_mei_sla', customerId: 'cust_mei_sla', customer: 'Northpoint Medical', company: 'Northpoint', postal: '768019', cluster: 'north', region: 'North', address: 'Northpoint Drive' },
  { id: 'site_causeway', customerId: 'cust_cp', customer: 'Causeway Point Clinic', company: 'CPC', postal: '738099', cluster: 'north', region: 'North', address: 'Woodlands Square' },
  { id: 'site_woodlands', customerId: 'cust_rahman', customer: 'Rahman Household', postal: '730123', cluster: 'north', region: 'North', address: 'Woodlands Dr 14' },
  { id: 'site_yishun_2', customerId: 'cust_yc', customer: 'Yishun Community Club', postal: '769098', cluster: 'north', region: 'North', address: 'Yishun Ave 11' },
  // west
  { id: 'site_kumar_1', customerId: 'cust_kumar', customer: 'Jurong West Block', postal: '640441', cluster: 'west', region: 'West', address: 'Jurong West St 42' },
  { id: 'site_kumar_2', customerId: 'cust_kumar', customer: 'Jurong West Block', postal: '609601', cluster: 'west', region: 'West', address: 'International Business Park' },
  { id: 'site_jonah_1', customerId: 'cust_jonah', customer: 'Clementi Shop', postal: '120440', cluster: 'west', region: 'West', address: 'Clementi Ave 3' },
  { id: 'site_jurong_east', customerId: 'cust_jem', customer: 'Jurong Gateway Offices', company: 'JGO', postal: '608549', cluster: 'west', region: 'West', address: 'Jurong Gateway Rd' },
  { id: 'site_jurong_west_2', customerId: 'cust_ong', customer: 'Ong Household', postal: '640789', cluster: 'west', region: 'West', address: 'Jurong West St 91' },
  { id: 'site_clementi_2', customerId: 'cust_nus', customer: 'Clementi Tutor Hub', postal: '129588', cluster: 'west', region: 'West', address: 'Clementi Rd' },
];

interface JobRow {
  id: string;
  site: string;
  type: string;
  /** Booked technician and start time; omitted for an unassigned job. */
  tech?: string;
  start?: string;
  window: [string, string];
  priority?: JobPriority;
  windowType?: WindowType;
  lock?: JobLockState;
  status?: JobStatus;
  minutes?: number;
  parts?: string[];
  note?: string;
}

// Today. Every technician has a believable day with room left in it.
const TODAY: JobRow[] = [
  {
    id: 'job_raffles', site: 'site_raffles', type: 'CRITICAL_HVAC_ELECTRICAL', window: ['13:00', '17:00'],
    priority: 'urgent', windowType: 'tight', status: 'unassigned', parts: ['inverter_board'],
    note: 'Chiller trip at Raffles Place. Needs HVAC + R32 and the inverter board on the van.',
  },
  // Wei, cbd, tier 1
  { id: 'job_wei_1', site: 'site_wei_1', type: 'GENERAL_SERVICE', tech: 'tech_wei', start: '09:00', window: ['09:00', '11:00'], priority: 'when_available' },
  { id: 'job_wei_2', site: 'site_chinatown', type: 'CHEMICAL_WASH', tech: 'tech_wei', start: '10:30', window: ['10:00', '13:00'] },
  { id: 'job_wei_3', site: 'site_tiong_bahru', type: 'GENERAL_SERVICE', tech: 'tech_wei', start: '14:00', window: ['13:00', '16:00'] },
  // Siti, east, tier 3, carries the inverter board. Nearest van to Raffles
  // Place, and free in the afternoon.
  { id: 'job_siti_1', site: 'site_siti_1', type: 'GENERAL_SERVICE', tech: 'tech_siti', start: '08:30', window: ['08:30', '10:00'] },
  { id: 'job_siti_2', site: 'site_siti_2', type: 'WATER_LEAK', tech: 'tech_siti', start: '10:30', window: ['10:30', '12:00'] },
  // Kumar, west, tier 3
  { id: 'job_kumar_1', site: 'site_kumar_1', type: 'GENERAL_SERVICE', tech: 'tech_kumar', start: '09:00', window: ['09:00', '11:00'] },
  { id: 'job_kumar_2', site: 'site_kumar_2', type: 'WATER_LEAK', tech: 'tech_kumar', start: '13:00', window: ['13:00', '15:00'] },
  { id: 'job_kumar_3', site: 'site_jurong_east', type: 'GAS_TOPUP', tech: 'tech_kumar', start: '15:30', window: ['15:00', '17:00'] },
  // Mei, north, tier 2; Northpoint's window is promised
  { id: 'job_mei_am', site: 'site_mei_am', type: 'GENERAL_SERVICE', tech: 'tech_mei', start: '09:00', window: ['09:00', '11:00'] },
  { id: 'job_mei_2', site: 'site_causeway', type: 'CHEMICAL_WASH', tech: 'tech_mei', start: '11:00', window: ['10:30', '13:00'] },
  {
    id: 'job_mei_sla', site: 'site_mei_sla', type: 'GENERAL_SERVICE', tech: 'tech_mei', start: '14:00', window: ['14:00', '16:00'],
    windowType: 'tight', lock: 'promised', minutes: 90, note: 'Clinic promised window. Do not move without desk approval.',
  },
  // Hafiz, bedok, tier 2; on site since 08:00
  {
    id: 'job_hafiz_1', site: 'site_hafiz_1', type: 'WATER_LEAK', tech: 'tech_hafiz', start: '08:00', window: ['08:00', '10:00'],
    windowType: 'tight', lock: 'in_progress', status: 'on_site',
  },
  { id: 'job_hafiz_2', site: 'site_hafiz_2', type: 'GENERAL_SERVICE', tech: 'tech_hafiz', start: '11:00', window: ['11:00', '12:30'] },
  { id: 'job_hafiz_3', site: 'site_hafiz_3', type: 'WATER_LEAK', tech: 'tech_hafiz', start: '14:00', window: ['14:00', '16:00'] },
  // Jonah, west, tier 4, carries the inverter board, accepts overtime. Further
  // from Raffles Place than Siti but with the lighter load: the trade-off.
  { id: 'job_jonah_1', site: 'site_jonah_1', type: 'GENERAL_SERVICE', tech: 'tech_jonah', start: '08:30', window: ['08:00', '10:00'] },
  { id: 'job_jonah_2', site: 'site_jurong_west_2', type: 'CHEMICAL_WASH', tech: 'tech_jonah', start: '10:30', window: ['10:00', '14:00'] },
  // Aisha, central, tier 3
  { id: 'job_aisha_1', site: 'site_toa_payoh', type: 'GAS_TOPUP', tech: 'tech_aisha', start: '09:00', window: ['09:00', '11:00'] },
  { id: 'job_aisha_2', site: 'site_novena', type: 'WATER_LEAK', tech: 'tech_aisha', start: '10:30', window: ['10:00', '12:30'] },
  { id: 'job_aisha_3', site: 'site_bishan', type: 'GENERAL_SERVICE', tech: 'tech_aisha', start: '14:00', window: ['13:00', '16:00'] },
  // Ravi, northeast, tier 2
  { id: 'job_ravi_1', site: 'site_hougang', type: 'GAS_TOPUP', tech: 'tech_ravi', start: '09:00', window: ['09:00', '11:00'] },
  { id: 'job_ravi_2', site: 'site_sengkang', type: 'WATER_LEAK', tech: 'tech_ravi', start: '11:00', window: ['10:30', '13:00'] },
  { id: 'job_ravi_3', site: 'site_pasir_ris', type: 'GAS_TOPUP', tech: 'tech_ravi', start: '13:30', window: ['13:00', '15:00'] },
  { id: 'job_ravi_4', site: 'site_punggol', type: 'GENERAL_SERVICE', tech: 'tech_ravi', start: '15:00', window: ['14:00', '17:00'] },
  // Daniel, south, tier 1 apprentice
  { id: 'job_daniel_1', site: 'site_vivo', type: 'GENERAL_SERVICE', tech: 'tech_daniel', start: '09:00', window: ['09:00', '11:00'] },
  { id: 'job_daniel_2', site: 'site_bukit_merah', type: 'CHEMICAL_WASH', tech: 'tech_daniel', start: '10:30', window: ['10:00', '13:00'] },
  // Farah, central, tier 2
  { id: 'job_farah_1', site: 'site_bishan_2', type: 'INSTALLATION', tech: 'tech_farah', start: '09:00', window: ['09:00', '12:30'] },
  { id: 'job_farah_2', site: 'site_novena', type: 'GENERAL_SERVICE', tech: 'tech_farah', start: '14:00', window: ['13:00', '16:00'] },
  // Marcus, cbd, tier 4; nearest senior to Raffles Place but booked through the afternoon
  { id: 'job_marcus_1', site: 'site_mbfc', type: 'WATER_LEAK', tech: 'tech_marcus', start: '09:00', window: ['09:00', '11:00'] },
  { id: 'job_marcus_2', site: 'site_shenton', type: 'GAS_TOPUP', tech: 'tech_marcus', start: '11:00', window: ['11:00', '12:30'] },
  { id: 'job_marcus_3', site: 'site_harbour', type: 'INSTALLATION', tech: 'tech_marcus', start: '13:30', window: ['13:00', '17:00'] },
  // Grace, north, tier 3
  { id: 'job_grace_1', site: 'site_woodlands', type: 'GAS_TOPUP', tech: 'tech_grace', start: '09:00', window: ['09:00', '11:00'] },
  { id: 'job_grace_2', site: 'site_yishun_2', type: 'WATER_LEAK', tech: 'tech_grace', start: '13:00', window: ['13:00', '15:00'] },
  // Hamid, west, tier 2
  { id: 'job_hamid_1', site: 'site_jurong_east', type: 'INSTALLATION', tech: 'tech_hamid', start: '09:00', window: ['09:00', '12:30'] },
  { id: 'job_hamid_2', site: 'site_clementi_2', type: 'WATER_LEAK', tech: 'tech_hamid', start: '14:00', window: ['13:30', '16:00'] },
  // Lina, northeast, tier 1
  { id: 'job_lina_1', site: 'site_punggol', type: 'CHEMICAL_WASH', tech: 'tech_lina', start: '09:00', window: ['09:00', '11:00'] },
  { id: 'job_lina_2', site: 'site_hougang_2', type: 'GENERAL_SERVICE', tech: 'tech_lina', start: '11:00', window: ['11:00', '12:30'] },
  { id: 'job_lina_3', site: 'site_sengkang_2', type: 'GENERAL_SERVICE', tech: 'tech_lina', start: '14:00', window: ['13:00', '16:00'] },
  // Ben, east, tier 2; his R32 lapsed last month. The east side's slack: free
  // late morning and early afternoon, so a sick call in Bedok has a legal cover.
  { id: 'job_ben_1', site: 'site_simei', type: 'WATER_LEAK', tech: 'tech_ben', start: '09:00', window: ['09:00', '11:00'] },
  { id: 'job_ben_2', site: 'site_pasir_ris_2', type: 'GENERAL_SERVICE', tech: 'tech_ben', start: '12:30', window: ['12:00', '14:00'] },
  { id: 'job_ben_3', site: 'site_tampines_3', type: 'CHEMICAL_WASH', tech: 'tech_ben', start: '16:00', window: ['13:00', '18:00'] },
];

// Tomorrow. Booked, nothing started. Gives the desk a second day to look at.
const TOMORROW: JobRow[] = [
  { id: 'job_d2_bedok_mall', site: 'site_bedok_mall', type: 'INSTALLATION', tech: 'tech_hafiz', start: '09:00', window: ['09:00', '13:00'] },
  { id: 'job_d2_simei', site: 'site_simei', type: 'GENERAL_SERVICE', tech: 'tech_hafiz', start: '14:00', window: ['13:00', '16:00'] },
  { id: 'job_d2_tampines', site: 'site_siti_1', type: 'GAS_TOPUP', tech: 'tech_siti', start: '09:00', window: ['09:00', '11:00'] },
  { id: 'job_d2_pasir_ris', site: 'site_pasir_ris_2', type: 'WATER_LEAK', tech: 'tech_siti', start: '13:00', window: ['13:00', '15:00'] },
  { id: 'job_d2_raffles_followup', site: 'site_raffles', type: 'GENERAL_SERVICE', tech: 'tech_marcus', start: '10:00', window: ['09:00', '12:00'], note: 'Follow-up check on the chiller.' },
  { id: 'job_d2_shenton', site: 'site_shenton', type: 'WATER_LEAK', tech: 'tech_marcus', start: '14:00', window: ['13:00', '16:00'] },
  { id: 'job_d2_novena', site: 'site_novena', type: 'CHEMICAL_WASH', tech: 'tech_aisha', start: '09:30', window: ['09:00', '12:00'] },
  { id: 'job_d2_toa_payoh', site: 'site_toa_payoh', type: 'GENERAL_SERVICE', tech: 'tech_farah', start: '10:00', window: ['09:00', '12:00'] },
  { id: 'job_d2_clementi', site: 'site_jonah_1', type: 'GAS_TOPUP', tech: 'tech_jonah', start: '09:00', window: ['09:00', '11:00'] },
  { id: 'job_d2_ibp', site: 'site_kumar_2', type: 'INSTALLATION', tech: 'tech_kumar', start: '10:00', window: ['09:00', '14:00'] },
  { id: 'job_d2_jurong', site: 'site_kumar_1', type: 'GENERAL_SERVICE', tech: 'tech_hamid', start: '15:00', window: ['14:00', '17:00'] },
  { id: 'job_d2_yishun', site: 'site_mei_am', type: 'WATER_LEAK', tech: 'tech_mei', start: '09:00', window: ['09:00', '11:00'] },
  { id: 'job_d2_woodlands', site: 'site_woodlands', type: 'GENERAL_SERVICE', tech: 'tech_grace', start: '13:00', window: ['13:00', '15:00'] },
  { id: 'job_d2_sengkang', site: 'site_sengkang', type: 'GAS_TOPUP', tech: 'tech_ravi', start: '10:00', window: ['09:00', '12:00'] },
  { id: 'job_d2_punggol', site: 'site_punggol', type: 'GENERAL_SERVICE', tech: 'tech_lina', start: '14:00', window: ['13:00', '16:00'] },
  { id: 'job_d2_vivo', site: 'site_vivo', type: 'CHEMICAL_WASH', tech: 'tech_daniel', start: '09:30', window: ['09:00', '12:00'] },
  { id: 'job_d2_chinatown', site: 'site_chinatown', type: 'GENERAL_SERVICE', tech: 'tech_wei', start: '11:00', window: ['10:00', '13:00'] },
  { id: 'job_d2_tampines_3', site: 'site_tampines_3', type: 'WATER_LEAK', tech: 'tech_ben', start: '10:00', window: ['09:00', '12:00'] },
];

// ---------------------------------------------------------------------------
// Assembly. `date` is the board's "today".

export function buildScenario(date: string): Scenario {
  const created = `${date}T00:00:00+08:00`;
  const days = [date, addDays(date, 1)] as const;
  const at = (day: string, hhmm: string) => `${day}T${hhmm}:00+08:00`;
  const plusMinutes = (day: string, hhmm: string, minutes: number) => {
    const [h, m] = hhmm.split(':').map(Number) as [number, number];
    const total = h * 60 + m + minutes;
    const hh = String(Math.floor(total / 60)).padStart(2, '0');
    const mm = String(total % 60).padStart(2, '0');
    return at(day, `${hh}:${mm}`);
  };

  const users: AppUser[] = [
    { id: 'user_desk', demoLogin: 'desk', role: 'desk', name: 'Coordinator', createdAt: created },
    { id: 'user_admin', demoLogin: 'admin', role: 'admin', name: 'Admin', createdAt: created },
  ];

  const technicians: Technician[] = TECHS.map((t) => ({
    id: t.id,
    name: t.name,
    tier: t.tier,
    homeRegion: t.region,
    currentCluster: t.home,
    maxMinutesDay: 480,
    acceptsOt: t.acceptsOt ?? false,
    parts: t.parts ?? [],
    tools: [],
    isActive: true,
    createdAt: created,
  }));

  const lapsed = addDays(date, -30);
  const certs: TechnicianCert[] = TECHS.flatMap((t) => [
    ...t.certs.map((certType) => ({
      id: `cert_${t.id.slice(5)}_${certType.toLowerCase()}`,
      technicianId: t.id,
      certType,
      issuedAt: '2024-01-15',
      isLegalGate: LEGAL_GATES.includes(certType),
      createdAt: created,
    })),
    ...(t.expired ?? []).map((certType) => ({
      id: `cert_${t.id.slice(5)}_${certType.toLowerCase()}_lapsed`,
      technicianId: t.id,
      certType,
      issuedAt: '2023-01-15',
      expiresAt: lapsed,
      isLegalGate: LEGAL_GATES.includes(certType),
      createdAt: created,
    })),
  ]);

  // Today everyone has clocked in at 07:45; tomorrow is only rostered.
  const shifts: Shift[] = days.flatMap((day, i) =>
    TECHS.map((t) => ({
      id: `shift_${t.id}_${day}`,
      technicianId: t.id,
      shiftDate: day,
      status: i === 0 ? ('clocked_in' as const) : ('scheduled' as const),
      clockInAt: at(day, '07:45'),
      createdAt: created,
    })),
  );

  const jobTypes: JobType[] = JOB_TYPES.map((jt) => ({
    id: jt.id,
    name: jt.name,
    minTier: jt.minTier,
    difficulty: jt.difficulty,
    defaultMinutes: jt.minutes,
    slaHours: jt.slaHours,
    brandSensitive: jt.brandSensitive ?? false,
    createdAt: created,
  }));

  const jobTypeCerts: JobTypeCert[] = JOB_TYPES.flatMap((jt) =>
    jt.certs.map((certType) => ({
      id: `jtc_${jt.id.toLowerCase()}_${certType.toLowerCase()}`,
      jobTypeId: jt.id,
      certType,
      brandRequired: false,
    })),
  );

  const customers: Customer[] = [];
  for (const s of SITES) {
    if (customers.some((c) => c.id === s.customerId)) continue;
    customers.push({
      id: s.customerId,
      name: s.customer,
      phone: `65${String(11110000 + customers.length + 1)}`,
      companyName: s.company,
      createdAt: created,
    });
  }

  const sites: Site[] = SITES.map((s) => ({
    id: s.id,
    customerId: s.customerId,
    postalCode: s.postal,
    region: s.region,
    estateCluster: s.cluster,
    addressLine1: s.address,
    unitNo: '#01-01',
    accessFlags: [],
    createdAt: created,
  }));

  const jobs: Job[] = [];
  const jobRequirements: JobRequirement[] = [];
  const assignments: Assignment[] = [];

  const place = (rows: JobRow[], day: string) => {
    for (const row of rows) {
      const type = JOB_TYPES.find((jt) => jt.id === row.type);
      const site = SITES.find((s) => s.id === row.site);
      if (!type || !site) throw new Error(`scenario row ${row.id} references an unknown type or site`);
      const minutes = row.minutes ?? type.minutes;

      jobs.push({
        id: row.id,
        customerId: site.customerId,
        siteId: site.id,
        jobTypeId: type.id,
        status: row.status ?? (row.tech ? 'assigned' : 'unassigned'),
        priority: row.priority ?? 'on_demand',
        windowType: row.windowType ?? 'loose',
        lockState: row.lock ?? 'none',
        scheduledDate: day,
        windowStart: at(day, row.window[0]),
        windowEnd: at(day, row.window[1]),
        durationMinutes: minutes,
        partsRequired: row.parts ?? [],
        toolsRequired: [],
        noteRaw: row.note ?? '',
        requiredCrewSize: 1,
        boardVersionAtRank: 1,
        confidenceScore: 1,
        createdAt: created,
        updatedAt: created,
      });

      jobRequirements.push({
        id: `jreq_${row.id.slice(4)}`,
        jobId: row.id,
        minTier: type.minTier,
        requiredCerts: [...type.certs],
        requiredCrewSize: 1,
        createdAt: created,
      });

      if (row.tech && row.start) {
        assignments.push({
          id: `asg_${row.id.slice(4)}`,
          jobId: row.id,
          technicianId: row.tech,
          status: 'accepted',
          snapshotId: SNAPSHOT_V1_ID,
          windowStart: at(day, row.start),
          windowEnd: plusMinutes(day, row.start, minutes),
          travelBeforeMinutes: 8,
          offeredAt: created,
          acceptedAt: created,
          metrics: emptyPlanMetrics(),
        });
      }
    }
  };
  place(TODAY, days[0]);
  place(TOMORROW, days[1]);

  const travel: TravelMatrix[] = [];
  let n = 0;
  for (const from of CLUSTERS) {
    for (const to of CLUSTERS) {
      n += 1;
      const [minutes, peakMinutes] = from === to ? SAME_CLUSTER : PAIR_MINUTES[pairKey(from, to)]!;
      travel.push({ id: `tm_${n}`, fromCluster: from, toCluster: to, minutes, peakMinutes, source: 'fixture', createdAt: created });
    }
  }

  const snapshot: BoardSnapshot = {
    id: SNAPSHOT_V1_ID,
    version: 1,
    snapshotData: { date, scenario: FINALS_SCENARIO, assignmentIds: assignments.map((a) => a.id) },
    metrics: emptyPlanMetrics() as unknown as Record<string, unknown>,
    createdBy: 'user_desk',
    committedAt: created,
    createdAt: created,
  };

  return {
    date,
    snapshot,
    users,
    technicians,
    certs,
    shifts,
    jobTypes,
    jobTypeCerts,
    customers,
    sites,
    jobs,
    jobRequirements,
    assignments,
    travel,
  };
}
