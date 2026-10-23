import type {
  BoundingBox,
  GeoPoint,
  RescueRequest,
  RescueResource,
  ResourceType,
  Scenario,
  ScenarioMetadata,
  Shelter,
  UrgencyLevel,
} from '@floodrelay/shared';

export interface GeneratorOptions {
  seed: number;
  id?: string;
  name?: string;
  region?: string;
  requestCount?: number;
  resourceCount?: number;
  shelterCount?: number;
  bounds?: BoundingBox;
  clusterCount?: number;
}

export const ASSUMED_BOAT_SPEED_MIN_KMH = 20; // placeholder, not measured
export const ASSUMED_BOAT_SPEED_MAX_KMH = 30; // placeholder, not measured
export const ASSUMED_TRUCK_SPEED_MIN_KMH = 35; // placeholder, not measured
export const ASSUMED_TRUCK_SPEED_MAX_KMH = 50; // placeholder, not measured

// Deterministic Mulberry32 PRNG
export class SeededRNG {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  // Returns pseudo-random float in [0, 1)
  next(): number {
    this.s |= 0;
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  pick<T>(items: readonly T[]): T {
    const idx = Math.floor(this.next() * items.length);
    const item = items[idx];
    if (item === undefined) {
      throw new Error('Cannot pick from empty array');
    }
    return item;
  }

  // Standard Box-Muller transform for normal distribution
  nextGaussian(mean = 0, stdev = 1): number {
    const u1 = Math.max(1e-15, this.next());
    const u2 = this.next();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + z0 * stdev;
  }
}

// Default regional bounding box: Delhi NCR Yamuna basin
export const DEFAULT_DELHI_BOUNDS: BoundingBox = {
  minLat: 28.55,
  maxLat: 28.78,
  minLng: 77.15,
  maxLng: 77.35,
};

const URGENCY_DISTRIBUTION: readonly { level: UrgencyLevel; weight: number }[] = [
  { level: 'LOW', weight: 40 },
  { level: 'MEDIUM', weight: 35 },
  { level: 'HIGH', weight: 20 },
  { level: 'CRITICAL', weight: 5 },
];

function pickUrgency(rng: SeededRNG): UrgencyLevel {
  const roll = rng.nextFloat(0, 100);
  let accum = 0;
  for (const item of URGENCY_DISTRIBUTION) {
    accum += item.weight;
    if (roll <= accum) {
      return item.level;
    }
  }
  return 'LOW';
}

export function generateScenario(options: GeneratorOptions): Scenario {
  const seed = options.seed;
  const rng = new SeededRNG(seed);

  const scenarioId = options.id ?? `scenario-seeded-${seed}`;
  const scenarioName = options.name ?? `Simulated Flood Scenario (Seed ${seed})`;
  const region = options.region ?? 'Yamuna Basin, Delhi NCR';
  const bounds = options.bounds ?? DEFAULT_DELHI_BOUNDS;

  const requestCount = options.requestCount ?? 50;
  const resourceCount = options.resourceCount ?? 6;
  const shelterCount = options.shelterCount ?? 3;
  const clusterCount = options.clusterCount ?? Math.max(2, Math.floor(requestCount / 20));

  // 1. Generate Hotspot cluster centers for realistic geographic demand aggregation
  const clusterCenters: GeoPoint[] = [];
  for (let i = 0; i < clusterCount; i++) {
    clusterCenters.push({
      lat: rng.nextFloat(bounds.minLat + 0.03, bounds.maxLat - 0.03),
      lng: rng.nextFloat(bounds.minLng + 0.03, bounds.maxLng - 0.03),
    });
  }

  // 2. Generate Safe Shelters at safe perimeter points
  const shelters: Shelter[] = [];
  for (let i = 0; i < shelterCount; i++) {
    const shelterId = `shelter-${i + 1}`;
    // Spread shelters around the boundary margins
    const lat = rng.nextFloat(bounds.minLat + 0.01, bounds.maxLat - 0.01);
    const lng = rng.next() > 0.5 ? bounds.minLng + 0.02 : bounds.maxLng - 0.02;
    shelters.push({
      id: shelterId,
      name: `Safe Haven Relief Hub ${i + 1}`,
      lat,
      lng,
      capacity: Math.max(100, Math.ceil((requestCount * 4) / shelterCount)),
      currentOccupancy: 0,
    });
  }

  // 3. Generate Rescue Requests (75% clustered around flood hotspots, 25% scattered)
  const requests: RescueRequest[] = [];
  const baseTime = Date.parse('2026-10-15T06:00:00.000Z');

  for (let i = 0; i < requestCount; i++) {
    const isClustered = rng.next() < 0.75;
    let lat: number;
    let lng: number;

    if (isClustered && clusterCenters.length > 0) {
      const center = rng.pick(clusterCenters);
      // Stdev of ~1.2 km in degrees (~0.01 deg)
      lat = rng.nextGaussian(center.lat, 0.012);
      lng = rng.nextGaussian(center.lng, 0.012);
    } else {
      lat = rng.nextFloat(bounds.minLat, bounds.maxLat);
      lng = rng.nextFloat(bounds.minLng, bounds.maxLng);
    }

    // Clamp coordinates within the scenario bounds
    lat = Math.max(bounds.minLat, Math.min(bounds.maxLat, lat));
    lng = Math.max(bounds.minLng, Math.min(bounds.maxLng, lng));

    // Stagger request timestamps over 2 hours
    const minutesOffset = rng.nextInt(0, 120);
    const createdAt = new Date(baseTime + minutesOffset * 60 * 1000).toISOString();

    const urgency = pickUrgency(rng);
    const peopleCount = rng.nextInt(1, 6);
    const medicalNeeds = urgency === 'CRITICAL' ? rng.next() < 0.7 : rng.next() < 0.15;

    requests.push({
      id: `req-${String(i + 1).padStart(4, '0')}`,
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      peopleCount,
      urgency,
      createdAt,
      source: 'SIMULATED',
      status: 'PENDING',
      medicalNeeds,
    });
  }

  // 4. Generate Rescue Resources (Boats and High-Water Vehicles)
  const resources: RescueResource[] = [];
  for (let i = 0; i < resourceCount; i++) {
    const isBoat = rng.next() < 0.6;
    const type: ResourceType = isBoat ? 'BOAT' : 'HIGH_WATER_VEHICLE';
    const capacity = isBoat ? rng.nextInt(6, 10) : rng.nextInt(12, 18);
    const speedKmH = isBoat
      ? rng.nextInt(ASSUMED_BOAT_SPEED_MIN_KMH, ASSUMED_BOAT_SPEED_MAX_KMH)
      : rng.nextInt(ASSUMED_TRUCK_SPEED_MIN_KMH, ASSUMED_TRUCK_SPEED_MAX_KMH);

    // Initial deployment from nearest shelter / depot
    const depot = shelters[i % shelters.length];
    const initialLat = depot ? depot.lat + rng.nextFloat(-0.005, 0.005) : bounds.minLat;
    const initialLng = depot ? depot.lng + rng.nextFloat(-0.005, 0.005) : bounds.minLng;

    resources.push({
      id: `res-${type.toLowerCase().slice(0, 4)}-${String(i + 1).padStart(2, '0')}`,
      name: `${isBoat ? 'Inflatable Boat' : 'High-Water Truck'} ${i + 1}`,
      type,
      capacity,
      speedKmH,
      lat: Number(initialLat.toFixed(6)),
      lng: Number(initialLng.toFixed(6)),
      status: 'AVAILABLE',
      depotId: depot?.id,
    });
  }

  const metadata: ScenarioMetadata = {
    id: scenarioId,
    name: scenarioName,
    region,
    seed,
    createdAt: new Date().toISOString(),
    bounds,
  };

  return {
    id: scenarioId,
    metadata,
    requests,
    resources,
    shelters,
  };
}
