import { EASTWIND_DATE, SNAPSHOT_V1_ID } from '../config/demo';
import type { CompanySettings } from '../contracts/settings';
import {
  emptyPlanMetrics,
  type AppUser,
  type Assignment,
  type BoardSnapshot,
  type Customer,
  type Job,
  type JobRequirement,
  type JobType,
  type JobTypeCert,
  type Shift,
  type Site,
  type Technician,
  type TechnicianCert,
  type TravelMatrix,
} from '../types/domain';

const CREATED = `${EASTWIND_DATE}T00:00:00+08:00`;

function at(hour: number, minute = 0): string {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${EASTWIND_DATE}T${hh}:${mm}:00+08:00`;
}

const CLUSTERS = ['cbd', 'east', 'west', 'north', 'northeast', 'bedok'] as const;

const PAIR_MINUTES: Record<string, [number, number]> = {
  'cbd|east': [22, 34],
  'cbd|west': [30, 46],
  'cbd|north': [35, 52],
  'cbd|northeast': [28, 42],
  'cbd|bedok': [32, 48],
  'east|west': [45, 65],
  'east|north': [35, 50],
  'east|northeast': [20, 30],
  'east|bedok': [15, 25],
  'west|north': [40, 55],
  'west|northeast': [50, 70],
  'west|bedok': [55, 75],
  'north|northeast': [20, 30],
  'north|bedok': [40, 55],
  'northeast|bedok': [25, 38],
};

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function buildTravel(): TravelMatrix[] {
  const rows: TravelMatrix[] = [];
  let n = 0;
  for (const from of CLUSTERS) {
    for (const to of CLUSTERS) {
      n += 1;
      if (from === to) {
        rows.push({
          id: `tm_${n}`,
          fromCluster: from,
          toCluster: to,
          minutes: 8,
          peakMinutes: 12,
          source: 'fixture',
          createdAt: CREATED,
        });
        continue;
      }
      const [minutes, peakMinutes] = PAIR_MINUTES[pairKey(from, to)] ?? [40, 60];
      rows.push({
        id: `tm_${n}`,
        fromCluster: from,
        toCluster: to,
        minutes,
        peakMinutes,
        source: 'fixture',
        createdAt: CREATED,
      });
    }
  }
  return rows;
}

const users: AppUser[] = [
  { id: 'user_desk', demoLogin: 'desk', role: 'desk', name: 'Coordinator', createdAt: CREATED },
  { id: 'user_admin', demoLogin: 'admin', role: 'admin', name: 'Admin', createdAt: CREATED },
];

const technicians: Technician[] = [
  {
    id: 'tech_wei',
    name: 'Wei',
    tier: 1,
    homeRegion: 'Central',
    currentCluster: 'cbd',
    maxMinutesDay: 480,
    acceptsOt: false,
    parts: [],
    tools: [],
    isActive: true,
    createdAt: CREATED,
  },
  {
    id: 'tech_siti',
    name: 'Siti',
    tier: 3,
    homeRegion: 'East',
    currentCluster: 'east',
    maxMinutesDay: 480,
    acceptsOt: false,
    parts: ['inverter_board'],
    tools: [],
    isActive: true,
    createdAt: CREATED,
  },
  {
    id: 'tech_kumar',
    name: 'Kumar',
    tier: 3,
    homeRegion: 'West',
    currentCluster: 'west',
    maxMinutesDay: 480,
    acceptsOt: false,
    parts: [],
    tools: [],
    isActive: true,
    createdAt: CREATED,
  },
  {
    id: 'tech_mei',
    name: 'Mei',
    tier: 2,
    homeRegion: 'North',
    currentCluster: 'north',
    maxMinutesDay: 480,
    acceptsOt: false,
    parts: [],
    tools: [],
    isActive: true,
    createdAt: CREATED,
  },
  {
    id: 'tech_hafiz',
    name: 'Hafiz',
    tier: 2,
    homeRegion: 'East',
    currentCluster: 'bedok',
    maxMinutesDay: 480,
    acceptsOt: false,
    parts: [],
    tools: [],
    isActive: true,
    createdAt: CREATED,
  },
  {
    id: 'tech_jonah',
    name: 'Jonah',
    tier: 4,
    homeRegion: 'West',
    currentCluster: 'west',
    maxMinutesDay: 480,
    acceptsOt: true,
    parts: ['inverter_board'],
    tools: [],
    isActive: true,
    createdAt: CREATED,
  },
];

function cert(
  id: string,
  technicianId: string,
  certType: TechnicianCert['certType'],
  opts?: { expiresAt?: string; legal?: boolean },
): TechnicianCert {
  return {
    id,
    technicianId,
    certType,
    issuedAt: '2024-01-15',
    expiresAt: opts?.expiresAt,
    isLegalGate: opts?.legal ?? ['NEA_R32', 'BCA_STRUCTURAL', 'EMA_LEW'].includes(String(certType)),
    createdAt: CREATED,
  };
}

const certs: TechnicianCert[] = [
  cert('cert_wei_wsh', 'tech_wei', 'WSH_PASS', { legal: false }),
  cert('cert_wei_r32', 'tech_wei', 'NEA_R32', { expiresAt: '2025-01-01', legal: true }),
  cert('cert_siti_wsh', 'tech_siti', 'WSH_PASS', { legal: false }),
  cert('cert_siti_hvac', 'tech_siti', 'NITEC_HVAC', { legal: false }),
  cert('cert_siti_r32', 'tech_siti', 'NEA_R32', { legal: true }),
  cert('cert_kumar_wsh', 'tech_kumar', 'WSH_PASS', { legal: false }),
  cert('cert_kumar_hvac', 'tech_kumar', 'NITEC_HVAC', { legal: false }),
  cert('cert_kumar_r32', 'tech_kumar', 'NEA_R32', { legal: true }),
  cert('cert_mei_wsh', 'tech_mei', 'WSH_PASS', { legal: false }),
  cert('cert_mei_hvac', 'tech_mei', 'NITEC_HVAC', { legal: false }),
  cert('cert_hafiz_wsh', 'tech_hafiz', 'WSH_PASS', { legal: false }),
  cert('cert_hafiz_hvac', 'tech_hafiz', 'NITEC_HVAC', { legal: false }),
  cert('cert_jonah_wsh', 'tech_jonah', 'WSH_PASS', { legal: false }),
  cert('cert_jonah_hvac', 'tech_jonah', 'NITEC_HVAC', { legal: false }),
  cert('cert_jonah_r32', 'tech_jonah', 'NEA_R32', { legal: true }),
  cert('cert_jonah_lew', 'tech_jonah', 'EMA_LEW', { legal: true }),
];

const shifts: Shift[] = technicians.map((t) => ({
  id: `shift_${t.id}`,
  technicianId: t.id,
  shiftDate: EASTWIND_DATE,
  status: 'clocked_in' as const,
  clockInAt: at(7, 45),
  createdAt: CREATED,
}));

const jobTypes: JobType[] = [
  {
    id: 'GENERAL_SERVICE',
    name: 'General Aircon Service',
    minTier: 1,
    difficulty: 1,
    defaultMinutes: 60,
    slaHours: 48,
    brandSensitive: false,
    createdAt: CREATED,
  },
  {
    id: 'WATER_LEAK',
    name: 'Water Leakage Repair',
    minTier: 2,
    difficulty: 2,
    defaultMinutes: 90,
    slaHours: 4,
    brandSensitive: false,
    createdAt: CREATED,
  },
  {
    id: 'CRITICAL_HVAC_ELECTRICAL',
    name: 'Critical HVAC + electrical (scarce cert + carried part)',
    minTier: 3,
    difficulty: 5,
    defaultMinutes: 90,
    slaHours: 2,
    brandSensitive: true,
    createdAt: CREATED,
  },
];

const jobTypeCerts: JobTypeCert[] = [
  { id: 'jtc_crit_hvac', jobTypeId: 'CRITICAL_HVAC_ELECTRICAL', certType: 'NITEC_HVAC', brandRequired: false },
  { id: 'jtc_crit_r32', jobTypeId: 'CRITICAL_HVAC_ELECTRICAL', certType: 'NEA_R32', brandRequired: false },
];

const customers: Customer[] = [
  { id: 'cust_raffles', name: 'Raffles Place Capital', phone: '6511110001', companyName: 'RPC Pte Ltd', createdAt: CREATED },
  { id: 'cust_mei_am', name: 'Tan Household', phone: '6511110002', createdAt: CREATED },
  { id: 'cust_mei_sla', name: 'Northpoint Medical', phone: '6511110003', companyName: 'Northpoint', createdAt: CREATED },
  { id: 'cust_hafiz', name: 'Bedok Residences', phone: '6511110004', createdAt: CREATED },
  { id: 'cust_siti', name: 'Tampines Hub', phone: '6511110005', createdAt: CREATED },
  { id: 'cust_kumar', name: 'Jurong West Block', phone: '6511110006', createdAt: CREATED },
  { id: 'cust_jonah', name: 'Clementi Shop', phone: '6511110007', createdAt: CREATED },
  { id: 'cust_wei', name: 'Telok Ayer Walk-up', phone: '6511110008', createdAt: CREATED },
];

function site(
  id: string,
  customerId: string,
  postal: string,
  region: string,
  cluster: string,
  address: string,
): Site {
  return {
    id,
    customerId,
    postalCode: postal,
    region,
    estateCluster: cluster,
    addressLine1: address,
    unitNo: '#01-01',
    accessFlags: [],
    createdAt: CREATED,
  };
}

const sites: Site[] = [
  site('site_raffles', 'cust_raffles', '048616', 'Central', 'cbd', '1 Raffles Place'),
  site('site_mei_am', 'cust_mei_am', '760123', 'North', 'north', 'Yishun Ave 2'),
  site('site_mei_sla', 'cust_mei_sla', '768019', 'North', 'north', 'Northpoint Drive'),
  site('site_hafiz_1', 'cust_hafiz', '460001', 'East', 'bedok', 'Bedok North St 1'),
  site('site_hafiz_2', 'cust_hafiz', '460088', 'East', 'bedok', 'Bedok Reservoir Rd'),
  site('site_hafiz_3', 'cust_hafiz', '469662', 'East', 'bedok', 'Eastwood Centre'),
  site('site_siti_1', 'cust_siti', '529510', 'East', 'east', 'Tampines Walk'),
  site('site_siti_2', 'cust_siti', '528523', 'East', 'east', 'Tampines Ave 5'),
  site('site_kumar_1', 'cust_kumar', '640441', 'West', 'west', 'Jurong West St 42'),
  site('site_kumar_2', 'cust_kumar', '609601', 'West', 'west', 'International Business Park'),
  site('site_jonah_1', 'cust_jonah', '120440', 'West', 'west', 'Clementi Ave 3'),
  site('site_wei_1', 'cust_wei', '048619', 'Central', 'cbd', 'Telok Ayer St'),
];

function job(partial: Omit<Job, 'createdAt' | 'updatedAt' | 'requiredCrewSize' | 'boardVersionAtRank' | 'confidenceScore'> & Partial<Job>): Job {
  return {
    requiredCrewSize: 1,
    boardVersionAtRank: 1,
    confidenceScore: 1,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...partial,
  };
}

const jobs: Job[] = [
  job({
    id: 'job_raffles',
    customerId: 'cust_raffles',
    siteId: 'site_raffles',
    jobTypeId: 'CRITICAL_HVAC_ELECTRICAL',
    status: 'unassigned',
    priority: 'urgent',
    windowType: 'tight',
    lockState: 'none',
    scheduledDate: EASTWIND_DATE,
    windowStart: at(13),
    windowEnd: at(17),
    durationMinutes: 90,
    partsRequired: ['inverter_board'],
    toolsRequired: [],
    noteRaw: 'Chiller trip at Raffles Place. Needs HVAC + R32 and the inverter board on the van.',
  }),
  job({
    id: 'job_mei_am',
    customerId: 'cust_mei_am',
    siteId: 'site_mei_am',
    jobTypeId: 'GENERAL_SERVICE',
    status: 'assigned',
    priority: 'on_demand',
    windowType: 'loose',
    lockState: 'none',
    scheduledDate: EASTWIND_DATE,
    windowStart: at(9),
    windowEnd: at(11),
    durationMinutes: 60,
    partsRequired: [],
    toolsRequired: [],
    noteRaw: '',
  }),
  job({
    id: 'job_mei_sla',
    customerId: 'cust_mei_sla',
    siteId: 'site_mei_sla',
    jobTypeId: 'GENERAL_SERVICE',
    status: 'assigned',
    priority: 'on_demand',
    windowType: 'tight',
    lockState: 'promised',
    scheduledDate: EASTWIND_DATE,
    windowStart: at(14),
    windowEnd: at(16),
    durationMinutes: 90,
    partsRequired: [],
    toolsRequired: [],
    noteRaw: 'Clinic promised window. Do not move without desk approval.',
  }),
  job({
    id: 'job_hafiz_1',
    customerId: 'cust_hafiz',
    siteId: 'site_hafiz_1',
    jobTypeId: 'WATER_LEAK',
    status: 'on_site',
    priority: 'on_demand',
    windowType: 'tight',
    lockState: 'in_progress',
    scheduledDate: EASTWIND_DATE,
    windowStart: at(8),
    windowEnd: at(10),
    durationMinutes: 90,
    partsRequired: [],
    toolsRequired: [],
    noteRaw: '',
  }),
  job({
    id: 'job_hafiz_2',
    customerId: 'cust_hafiz',
    siteId: 'site_hafiz_2',
    jobTypeId: 'GENERAL_SERVICE',
    status: 'assigned',
    priority: 'on_demand',
    windowType: 'loose',
    lockState: 'none',
    scheduledDate: EASTWIND_DATE,
    windowStart: at(11),
    windowEnd: at(12, 30),
    durationMinutes: 60,
    partsRequired: [],
    toolsRequired: [],
    noteRaw: '',
  }),
  job({
    id: 'job_hafiz_3',
    customerId: 'cust_hafiz',
    siteId: 'site_hafiz_3',
    jobTypeId: 'WATER_LEAK',
    status: 'assigned',
    priority: 'on_demand',
    windowType: 'loose',
    lockState: 'none',
    scheduledDate: EASTWIND_DATE,
    windowStart: at(14),
    windowEnd: at(16),
    durationMinutes: 90,
    partsRequired: [],
    toolsRequired: [],
    noteRaw: '',
  }),
  job({
    id: 'job_siti_1',
    customerId: 'cust_siti',
    siteId: 'site_siti_1',
    jobTypeId: 'GENERAL_SERVICE',
    status: 'assigned',
    priority: 'on_demand',
    windowType: 'loose',
    lockState: 'none',
    scheduledDate: EASTWIND_DATE,
    windowStart: at(8, 30),
    windowEnd: at(10),
    durationMinutes: 60,
    partsRequired: [],
    toolsRequired: [],
    noteRaw: '',
  }),
  job({
    id: 'job_siti_2',
    customerId: 'cust_siti',
    siteId: 'site_siti_2',
    jobTypeId: 'WATER_LEAK',
    status: 'assigned',
    priority: 'on_demand',
    windowType: 'loose',
    lockState: 'none',
    scheduledDate: EASTWIND_DATE,
    windowStart: at(10, 30),
    windowEnd: at(12),
    durationMinutes: 75,
    partsRequired: [],
    toolsRequired: [],
    noteRaw: '',
  }),
  job({
    id: 'job_kumar_1',
    customerId: 'cust_kumar',
    siteId: 'site_kumar_1',
    jobTypeId: 'GENERAL_SERVICE',
    status: 'assigned',
    priority: 'on_demand',
    windowType: 'loose',
    lockState: 'none',
    scheduledDate: EASTWIND_DATE,
    windowStart: at(9),
    windowEnd: at(11),
    durationMinutes: 90,
    partsRequired: [],
    toolsRequired: [],
    noteRaw: '',
  }),
  job({
    id: 'job_kumar_2',
    customerId: 'cust_kumar',
    siteId: 'site_kumar_2',
    jobTypeId: 'WATER_LEAK',
    status: 'assigned',
    priority: 'on_demand',
    windowType: 'loose',
    lockState: 'none',
    scheduledDate: EASTWIND_DATE,
    windowStart: at(13),
    windowEnd: at(15),
    durationMinutes: 90,
    partsRequired: [],
    toolsRequired: [],
    noteRaw: '',
  }),
  job({
    id: 'job_jonah_1',
    customerId: 'cust_jonah',
    siteId: 'site_jonah_1',
    jobTypeId: 'GENERAL_SERVICE',
    status: 'assigned',
    priority: 'on_demand',
    windowType: 'loose',
    lockState: 'none',
    scheduledDate: EASTWIND_DATE,
    windowStart: at(8),
    windowEnd: at(10),
    durationMinutes: 90,
    partsRequired: [],
    toolsRequired: [],
    noteRaw: '',
  }),
  job({
    id: 'job_wei_1',
    customerId: 'cust_wei',
    siteId: 'site_wei_1',
    jobTypeId: 'GENERAL_SERVICE',
    status: 'assigned',
    priority: 'when_available',
    windowType: 'loose',
    lockState: 'none',
    scheduledDate: EASTWIND_DATE,
    windowStart: at(9),
    windowEnd: at(11),
    durationMinutes: 60,
    partsRequired: [],
    toolsRequired: [],
    noteRaw: '',
  }),
];

const jobRequirements: JobRequirement[] = [
  {
    id: 'jreq_raffles',
    jobId: 'job_raffles',
    minTier: 3,
    requiredCerts: ['NITEC_HVAC', 'NEA_R32'],
    requiredCrewSize: 1,
    createdAt: CREATED,
  },
];

function slot(
  id: string,
  jobId: string,
  technicianId: string,
  start: string,
  end: string,
  status: Assignment['status'] = 'accepted',
): Assignment {
  return {
    id,
    jobId,
    technicianId,
    status,
    snapshotId: SNAPSHOT_V1_ID,
    windowStart: start,
    windowEnd: end,
    travelBeforeMinutes: 8,
    offeredAt: CREATED,
    acceptedAt: CREATED,
    metrics: emptyPlanMetrics(),
  };
}

const assignments: Assignment[] = [
  slot('asg_mei_am', 'job_mei_am', 'tech_mei', at(9), at(11)),
  slot('asg_mei_sla', 'job_mei_sla', 'tech_mei', at(14), at(16)),
  slot('asg_hafiz_1', 'job_hafiz_1', 'tech_hafiz', at(8), at(10)),
  slot('asg_hafiz_2', 'job_hafiz_2', 'tech_hafiz', at(11), at(12, 30)),
  slot('asg_hafiz_3', 'job_hafiz_3', 'tech_hafiz', at(14), at(16)),
  slot('asg_siti_1', 'job_siti_1', 'tech_siti', at(8, 30), at(10)),
  slot('asg_siti_2', 'job_siti_2', 'tech_siti', at(10, 30), at(12)),
  slot('asg_kumar_1', 'job_kumar_1', 'tech_kumar', at(9), at(11)),
  slot('asg_kumar_2', 'job_kumar_2', 'tech_kumar', at(13), at(15)),
  slot('asg_jonah_1', 'job_jonah_1', 'tech_jonah', at(8), at(10)),
  slot('asg_wei_1', 'job_wei_1', 'tech_wei', at(9), at(11)),
];

const snapshot: BoardSnapshot = {
  id: SNAPSHOT_V1_ID,
  version: 1,
  snapshotData: { date: EASTWIND_DATE, assignmentIds: assignments.map((a) => a.id) },
  metrics: emptyPlanMetrics() as unknown as Record<string, unknown>,
  createdBy: 'user_desk',
  committedAt: CREATED,
  createdAt: CREATED,
};

export const EASTWIND = {
  date: EASTWIND_DATE,
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
  travel: buildTravel(),
};

/**
 * The shape every seed takes: the Eastwind fixture and the finals scenario
 * alike. `company` seeds the settings row; without one the defaults apply.
 */
export type Scenario = typeof EASTWIND & { company?: CompanySettings };
