import type { BlockedZone } from '@floodrelay/shared';
import type { StagedAsset, StagedShelter } from '@/components/operator/map/LeafletMapCanvas';
import { REGION_CONFIG } from '@/lib/region';

/**
 * Native Delhi–Yamuna Floodplain tactical map reference metadata derived directly
 * from scenarios/sample-scenario.json. All assets, shelters, and hazard zones in
 * this module are explicitly SIMULATED demonstration references and do NOT represent
 * live emergency assets, official NDRF units, or verified active relief shelters.
 */
export const MAP_SCENARIO_NAME = 'Yamuna Flood Relief - North Delhi Basin (Simulated)';
export const MAP_SCENARIO_COORDINATES = '28.67° N, 77.23° E';

/**
 * Centralised default tactical map centre for the North Delhi / Yamuna Floodplain demo.
 * Derived from REGION_CONFIG; never restricts rendering of real database coordinates.
 */
export const TACTICAL_MAP_DEFAULT_CENTRE: [number, number] = [
  REGION_CONFIG.tacticalDemoCentre.lat,
  REGION_CONFIG.tacticalDemoCentre.lng,
];

export const TACTICAL_MAP_DEFAULT_ZOOM = REGION_CONFIG.tacticalDemoZoom;

/**
 * Staged reference fleet roster for demonstration display on the Operations GIS Tactical Map.
 * Mirrored directly from scenarios/sample-scenario.json resources.
 */
export const STAGED_SECTOR_FLEET: StagedAsset[] = [
  {
    id: 'res-boat-01',
    name: 'Simulated Rescue Boat Alpha (Demo — Not Official NDRF)',
    type: 'BOAT',
    capacity: 8,
    speedKmH: 25,
    lat: 28.66,
    lng: 77.22,
    status: 'AVAILABLE',
    depotName: 'Kashmere Gate Relief Camp (Simulated Reference)',
    source: 'SIMULATED',
  },
  {
    id: 'res-boat-02',
    name: 'Simulated Rescue Boat Bravo (Demo — Not Official NDRF)',
    type: 'BOAT',
    capacity: 10,
    speedKmH: 25,
    lat: 28.68,
    lng: 77.23,
    status: 'AVAILABLE',
    depotName: 'Wazirabad Community Relief Centre (Simulated Reference)',
    source: 'SIMULATED',
  },
  {
    id: 'res-truck-01',
    name: 'Simulated High-Clearance Truck 1 (Demo)',
    type: 'HIGH_WATER_VEHICLE',
    capacity: 15,
    speedKmH: 40,
    lat: 28.65,
    lng: 77.21,
    status: 'AVAILABLE',
    depotName: 'Yamuna Floodplain Relief Depot (Simulated Reference)',
    source: 'SIMULATED',
  },
];

/**
 * Simulated reference relief shelters for demonstration display on the Operations GIS Tactical Map.
 * Mirrored directly from scenarios/sample-scenario.json shelters.
 * Status explicitly discloses that capacity and operating state are simulated and unverified.
 */
export const STAGED_SECTOR_SHELTERS: StagedShelter[] = [
  {
    id: 'shelter-kashmere-gate',
    name: 'Kashmere Gate Relief Camp (Simulated Reference)',
    lat: 28.668,
    lng: 77.232,
    capacity: 120,
    availableBeds: 100,
    status: 'Simulated Reference — Unverified Capacity (Demo Only)',
    source: 'SIMULATED',
  },
  {
    id: 'shelter-wazirabad',
    name: 'Wazirabad Community Relief Centre (Simulated Reference)',
    lat: 28.705,
    lng: 77.228,
    capacity: 150,
    availableBeds: 115,
    status: 'Simulated Reference — Unverified Capacity (Demo Only)',
    source: 'SIMULATED',
  },
];

export type ReferenceBlockedZone = BlockedZone & { source: 'SIMULATED' };

/**
 * Simulated reference hazard zones for demonstration display on the Operations GIS Tactical Map.
 * Mirrored directly from scenarios/sample-scenario.json blockedZones.
 */
export const STAGED_SECTOR_BLOCKED_ZONES: ReferenceBlockedZone[] = [
  {
    id: 'zone-old-railway-bridge',
    name: 'Old Railway Bridge — Submerged (Simulated Reference)',
    severity: 'BLOCKED',
    polygon: [
      { lat: 28.662, lng: 77.24 },
      { lat: 28.665, lng: 77.245 },
      { lat: 28.661, lng: 77.247 },
      { lat: 28.658, lng: 77.242 },
    ],
    source: 'SIMULATED',
  },
];
