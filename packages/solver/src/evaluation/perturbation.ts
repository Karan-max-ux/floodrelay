import type {
  GeoPoint,
  RescueRequest,
  RouteStop,
  Scenario,
  SolverPlan,
  ResourceType,
} from '@floodrelay/shared';
import {
  StraightLineTravelTimeProvider,
  type TravelEstimate,
  type TravelTimeProvider,
} from '../routing/travelTime.js';
import { solveNearestFirst } from '../baselines/nearestFirst.js';
import { solveClarkeWrightBaseline } from '../baselines/clarkeWrightBaseline.js';
import { solveClusterAllocation } from '../heuristics/clusterAllocation.js';

export interface PlanChurnMetrics {
  assignmentChurnRate: number; // fraction of requests assigned to a different vehicle or unserved
  routeChurnRate: number; // fraction of vehicles whose ordered sequence of pickups changed
  sequenceChurnRate: number; // fraction of pickup transitions (predecessor) changed
  servedSetChanged: number; // count of requests whose served/unserved status flipped
  coverageDelta: number; // difference in total requests served (perturbed - baseline)
}

function getPoint(p: GeoPoint): { lat: number; lng: number } {
  const lat = p.lat ?? (p as unknown as { latitude?: number }).latitude ?? 0;
  const lng = p.lng ?? (p as unknown as { longitude?: number }).longitude ?? 0;
  return { lat, lng };
}

/**
 * 32-bit FNV-1a hash producing a deterministic float in [0, 1) for a pair of coordinates.
 */
function hashCoords(seed: number, from: GeoPoint, to: GeoPoint): number {
  const f = getPoint(from);
  const t = getPoint(to);
  const str = `${seed}|${f.lat.toFixed(6)},${f.lng.toFixed(6)}->${t.lat.toFixed(6)},${t.lng.toFixed(6)}`;

  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

/**
 * PerturbedTravelTimeProvider decorates an inner provider by multiplying distance and
 * duration by a deterministic perturbation factor in [1 - magnitude, 1 + magnitude].
 */
export class PerturbedTravelTimeProvider implements TravelTimeProvider {
  constructor(
    private readonly inner: TravelTimeProvider,
    private readonly magnitude: number,
    private readonly seed: number,
  ) {}

  getTravelEstimate(
    from: GeoPoint,
    to: GeoPoint,
    speedKmH?: number,
    isFlooded?: boolean,
    resourceType?: ResourceType,
  ): TravelEstimate {
    const base = this.inner.getTravelEstimate(from, to, speedKmH, isFlooded, resourceType);

    if (this.magnitude === 0) {
      return base;
    }

    const u = hashCoords(this.seed, from, to); // [0, 1)
    const factor = 1.0 + (u * 2 - 1) * this.magnitude; // in [1 - m, 1 + m]

    return {
      ...base,
      distanceKm: Number((base.distanceKm * factor).toFixed(3)),
      durationMinutes: Number((base.durationMinutes * factor).toFixed(2)),
    };
  }

  getMatrix(
    origins: GeoPoint[],
    destinations: GeoPoint[],
    speedKmH?: number,
    resourceType?: ResourceType,
  ): TravelEstimate[][] {
    return origins.map((origin) =>
      destinations.map((dest) =>
        this.getTravelEstimate(origin, dest, speedKmH, undefined, resourceType),
      ),
    );
  }
}

/**
 * Perturbs request submission timestamps by a random delta in [-maxMinutesDelta, +maxMinutesDelta].
 * NOTE: Current solver baselines do not read request createdAt timestamps; this function is
 * provided for future dynamic intake benchmarks.
 */
export function perturbRequestTimestamps(
  requests: RescueRequest[],
  maxMinutesDelta: number,
  seed: number,
): RescueRequest[] {
  if (maxMinutesDelta <= 0) {
    return requests;
  }

  return requests.map((req, idx) => {
    const u = hashCoords(
      seed + idx,
      { lat: req.lat, lng: req.lng },
      { lat: req.lat, lng: req.lng },
    );
    const deltaMs = (u * 2 - 1) * maxMinutesDelta * 60 * 1000;
    const originalTime = new Date(req.createdAt).getTime();
    const perturbedTime = new Date(originalTime + deltaMs).toISOString();

    return {
      ...req,
      createdAt: perturbedTime,
    };
  });
}

/**
 * Generic interface representing a planned route with stops.
 */
interface GenericRoute {
  vehicleId?: string;
  resourceId?: string;
  stops?: Array<{
    type?: string;
    requestId?: string;
    targetId?: string;
  }>;
}

interface GenericPlan {
  routes?: GenericRoute[];
  unservedRequests?: Array<{ id?: string; requestId?: string }>;
  unserved?: Array<{ id?: string; requestId?: string }>;
}

function extractPickupsByVehicle(routes: GenericRoute[]): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const route of routes) {
    const vId = route.resourceId ?? route.vehicleId ?? 'unknown';
    const pickups: string[] = [];

    for (const stop of route.stops ?? []) {
      const isPickup =
        stop.type === 'PICKUP' || (stop as unknown as RouteStop).passengersPickedUp > 0;

      if (isPickup) {
        const reqId = stop.targetId ?? stop.requestId;
        if (reqId) {
          pickups.push(reqId);
        }
      }
    }

    map.set(vId, pickups);
  }

  return map;
}

/**
 * Computes plan stability (churn) metrics between a baseline plan and a perturbed plan.
 */
export function computePlanChurn(
  baseline: SolverPlan | GenericPlan,
  perturbed: SolverPlan | GenericPlan,
): PlanChurnMetrics {
  const baseRoutes = baseline.routes ?? [];
  const pertRoutes = perturbed.routes ?? [];

  const basePickups = extractPickupsByVehicle(baseRoutes);
  const pertPickups = extractPickupsByVehicle(pertRoutes);

  // 1. Assignment Map: reqId -> vehicleId (or 'UNSERVED')
  const baseAssignment = new Map<string, string>();
  for (const [vId, reqs] of basePickups) {
    for (const r of reqs) {
      baseAssignment.set(r, vId);
    }
  }

  const pertAssignment = new Map<string, string>();
  for (const [vId, reqs] of pertPickups) {
    for (const r of reqs) {
      pertAssignment.set(r, vId);
    }
  }

  // All known request IDs across both plans
  const allRequests = new Set<string>([...baseAssignment.keys(), ...pertAssignment.keys()]);
  if (allRequests.size === 0) {
    return {
      assignmentChurnRate: 0,
      routeChurnRate: 0,
      sequenceChurnRate: 0,
      servedSetChanged: 0,
      coverageDelta: 0,
    };
  }

  let assignmentChanged = 0;
  let servedSetChanged = 0;

  for (const r of allRequests) {
    const baseV = baseAssignment.get(r);
    const pertV = pertAssignment.get(r);

    if (baseV !== pertV) {
      assignmentChanged++;
    }

    const baseServed = Boolean(baseV);
    const pertServed = Boolean(pertV);
    if (baseServed !== pertServed) {
      servedSetChanged++;
    }
  }

  const assignmentChurnRate = Number((assignmentChanged / allRequests.size).toFixed(4));

  // 2. Route Churn: fraction of vehicles whose ordered sequence of pickups changed
  const allVehicles = new Set<string>([...basePickups.keys(), ...pertPickups.keys()]);
  let routesChanged = 0;

  for (const v of allVehicles) {
    const bList = basePickups.get(v) ?? [];
    const pList = pertPickups.get(v) ?? [];

    if (bList.length !== pList.length) {
      routesChanged++;
      continue;
    }

    let identical = true;
    for (let i = 0; i < bList.length; i++) {
      if (bList[i] !== pList[i]) {
        identical = false;
        break;
      }
    }

    if (!identical) {
      routesChanged++;
    }
  }

  const routeChurnRate =
    allVehicles.size > 0 ? Number((routesChanged / allVehicles.size).toFixed(4)) : 0;

  // 3. Sequence Churn: fraction of requests whose pickup predecessor on the same vehicle changed
  let totalBaseServed = 0;
  let brokenPredecessors = 0;

  for (const [vId, bList] of basePickups) {
    const pList = pertPickups.get(vId) ?? [];
    const pertPredMap = new Map<string, string | null>();

    for (let i = 0; i < pList.length; i++) {
      const pred = i > 0 ? pList[i - 1]! : null;
      pertPredMap.set(pList[i]!, pred);
    }

    for (let i = 0; i < bList.length; i++) {
      totalBaseServed++;
      const reqId = bList[i]!;
      const basePred = i > 0 ? bList[i - 1]! : null;

      if (!pertPredMap.has(reqId) || pertPredMap.get(reqId) !== basePred) {
        brokenPredecessors++;
      }
    }
  }

  const sequenceChurnRate =
    totalBaseServed > 0 ? Number((brokenPredecessors / totalBaseServed).toFixed(4)) : 0;

  // 4. Coverage Delta: perturbed served count - baseline served count
  const coverageDelta = pertAssignment.size - baseAssignment.size;

  return {
    assignmentChurnRate,
    routeChurnRate,
    sequenceChurnRate,
    servedSetChanged,
    coverageDelta,
  };
}

export interface PerturbationStudyOptions {
  magnitudes?: number[];
  seeds?: number[];
}

export interface PerturbationStudyRow {
  scenarioId: string;
  solverName: string;
  magnitude: number;
  assignmentChurnRate: number;
  routeChurnRate: number;
  sequenceChurnRate: number;
  coverageDelta: number;
}

export interface PerturbationStudyResult {
  rows: PerturbationStudyRow[];
  timestamp: string;
}

/**
 * Runs a perturbation study evaluating the stability (churn) of Nearest-First,
 * Cluster-Allocation, and Clarke-Wright baselines under travel-time perturbations.
 *
 * NOTE: Google OR-Tools executes in a Python child process using internal distance calculations;
 * an external TypeScript TravelTimeProvider cannot be injected into the Python runtime,
 * so OR-Tools is excluded from this perturbation study.
 */
export function runPerturbationStudy(
  scenarios: Scenario[],
  options: PerturbationStudyOptions = {},
): PerturbationStudyResult {
  const magnitudes = options.magnitudes ?? [0, 0.1, 0.25, 0.5];
  const seeds = options.seeds ?? [42, 1337, 2026];

  const solvers: Array<{
    name: string;
    solve: (scenario: Scenario, provider: TravelTimeProvider) => SolverPlan;
  }> = [
    {
      name: 'Nearest-First (Greedy)',
      solve: (sc, prov) => solveNearestFirst(sc, { travelTimeProvider: prov }),
    },
    {
      name: 'Cluster-Allocation',
      solve: (sc, prov) => solveClusterAllocation(sc, { travelTimeProvider: prov }),
    },
    {
      name: 'Urgency-batched savings + 2-opt',
      solve: (sc, prov) => solveClarkeWrightBaseline(sc, { travelTimeProvider: prov }),
    },
  ];

  const rows: PerturbationStudyRow[] = [];
  const baseProvider = new StraightLineTravelTimeProvider();

  for (const scenario of scenarios) {
    for (const solver of solvers) {
      // Baseline run without perturbation
      const basePlan = solver.solve(scenario, baseProvider);

      for (const mag of magnitudes) {
        let sumAssignment = 0;
        let sumRoute = 0;
        let sumSequence = 0;
        let sumDelta = 0;

        for (const seed of seeds) {
          const pertProvider = new PerturbedTravelTimeProvider(baseProvider, mag, seed);
          const pertPlan = solver.solve(scenario, pertProvider);
          const churn = computePlanChurn(basePlan, pertPlan);

          sumAssignment += churn.assignmentChurnRate;
          sumRoute += churn.routeChurnRate;
          sumSequence += churn.sequenceChurnRate;
          sumDelta += churn.coverageDelta;
        }

        const count = seeds.length;
        rows.push({
          scenarioId: scenario.id,
          solverName: solver.name,
          magnitude: mag,
          assignmentChurnRate: Number((sumAssignment / count).toFixed(4)),
          routeChurnRate: Number((sumRoute / count).toFixed(4)),
          sequenceChurnRate: Number((sumSequence / count).toFixed(4)),
          coverageDelta: Number((sumDelta / count).toFixed(2)),
        });
      }
    }
  }

  return {
    rows,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Formats perturbation study results as a GitHub Flavored Markdown table.
 */
export function formatPerturbationResultsMarkdown(result: PerturbationStudyResult): string {
  const headers = [
    '| Scenario | Solver | Magnitude | Assignment Churn (%) | Route Churn (%) | Sequence Churn (%) | Coverage Delta |',
    '| :--- | :--- | :---: | :---: | :---: | :---: | :---: |',
  ];

  const lines = result.rows.map((row) => {
    const magPct = `${(row.magnitude * 100).toFixed(0)}%${row.magnitude === 0 ? ' (Control)' : ''}`;
    const assignPct = `${(row.assignmentChurnRate * 100).toFixed(1)}%`;
    const routePct = `${(row.routeChurnRate * 100).toFixed(1)}%`;
    const seqPct = `${(row.sequenceChurnRate * 100).toFixed(1)}%`;
    const delta = row.coverageDelta >= 0 ? `+${row.coverageDelta}` : `${row.coverageDelta}`;

    return `| ${row.scenarioId} | ${row.solverName} | ${magPct} | ${assignPct} | ${routePct} | ${seqPct} | ${delta} |`;
  });

  return [...headers, ...lines].join('\n');
}
