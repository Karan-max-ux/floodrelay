import type {
  RescueRequest,
  ResourceRoute,
  RouteStop,
  Scenario,
  SolverPlan,
  UnservedRequest,
} from '@floodrelay/shared';
import { clusterRequests } from '../clustering/dbscan.js';
import { calculatePlanMetrics } from '../metrics.js';
import { StraightLineTravelTimeProvider, type TravelTimeProvider } from '../routing/travelTime.js';

export interface ClusterAllocationOptions {
  epsilonMeters?: number;
  minPoints?: number;
  travelTimeProvider?: TravelTimeProvider;
  maxShiftMinutes?: number;
  existingFrozenRoutes?: ResourceRoute[];
}

const URGENCY_PRIORITY: Record<string, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

/**
 * Cluster-first allocation heuristic.
 * 1. Clusters demand using metric DBSCAN.
 * 2. Ranks clusters by urgency composition and passenger density.
 * 3. Assigns best-suited resources to clusters, performing multi-stop pickups and shelter dropoffs.
 * 4. Preserves any frozen committed stops at the head of existing routes.
 */
export function solveClusterAllocation(
  scenario: Scenario,
  options?: ClusterAllocationOptions,
): SolverPlan {
  const startTime = Date.now();
  const provider = options?.travelTimeProvider ?? new StraightLineTravelTimeProvider();
  const maxShiftMinutes = options?.maxShiftMinutes ?? 480;
  const epsilonMeters = options?.epsilonMeters ?? 1200;
  const minPoints = options?.minPoints ?? 2;

  const shelters = scenario.shelters;
  const availableResources = scenario.resources.filter(
    (r) => r.status === 'AVAILABLE' || r.status === 'ASSIGNED',
  );

  const unservedList: UnservedRequest[] = [];

  if (shelters.length === 0 || availableResources.length === 0) {
    for (const req of scenario.requests) {
      unservedList.push({
        requestId: req.id,
        reason: shelters.length === 0 ? 'NO_REACHABLE_RESOURCE' : 'CAPACITY_EXCEEDED',
        details: shelters.length === 0 ? 'No safe shelters in scenario' : 'No available resources',
      });
    }

    const duration = Date.now() - startTime;
    return {
      scenarioId: scenario.id,
      calculatedAt: new Date().toISOString(),
      routes: [],
      unserved: unservedList,
      metrics: calculatePlanMetrics(scenario, { routes: [], unserved: unservedList }, duration),
    };
  }

  // Map to track requests remaining to be assigned
  const remainingRequests = new Map(scenario.requests.map((r) => [r.id, r]));

  // Initialize routes from frozen stops if provided
  const routesByResource = new Map<
    string,
    {
      routeStops: RouteStop[];
      servedIds: string[];
      currentLocation: { lat: number; lng: number };
      currentMinutes: number;
      currentDistanceKm: number;
      currentLoad: number;
      stopCounter: number;
    }
  >();

  for (const res of availableResources) {
    routesByResource.set(res.id, {
      routeStops: [],
      servedIds: [],
      currentLocation: { lat: res.lat, lng: res.lng },
      currentMinutes: 0,
      currentDistanceKm: 0,
      currentLoad: 0,
      stopCounter: 1,
    });
  }

  // Pre-seed any frozen stops
  if (options?.existingFrozenRoutes) {
    for (const fRoute of options.existingFrozenRoutes) {
      const state = routesByResource.get(fRoute.resourceId);
      if (state) {
        for (const stop of fRoute.stops) {
          if (stop.isFrozen) {
            state.routeStops.push({ ...stop });
            if (stop.type === 'PICKUP') {
              state.servedIds.push(stop.targetId);
              state.currentLoad += stop.passengersPickedUp;
              remainingRequests.delete(stop.targetId);
            } else if (stop.type === 'DROPOFF') {
              state.currentLoad -= stop.passengersDroppedOff;
            }
            state.currentLocation = { lat: stop.lat, lng: stop.lng };
            state.currentMinutes = stop.estimatedArrivalMinutes;
            state.stopCounter = stop.stopNumber + 1;
          }
        }
      }
    }
  }

  // Step 1: Cluster remaining requests using DBSCAN
  const activeRequests = Array.from(remainingRequests.values());
  const clustering = clusterRequests(activeRequests, { epsilonMeters, minPoints });

  // Step 2: Sort clusters by priority (highest urgency score first, then passenger count)
  const scoreRequest = (r: RescueRequest): number => URGENCY_PRIORITY[r.urgency] ?? 1;

  const scoredClusters = clustering.clusters.map((c) => {
    let maxUrgency = 0;
    let urgencySum = 0;
    for (const item of c.items) {
      const score = scoreRequest(item);
      urgencySum += score;
      if (score > maxUrgency) maxUrgency = score;
    }
    const priorityScore = maxUrgency * 100 + urgencySum * 10 + c.totalPeopleCount;
    return {
      cluster: c,
      priorityScore,
      items: [...c.items].sort((a, b) => scoreRequest(b) - scoreRequest(a)),
    };
  });

  scoredClusters.sort((a, b) => b.priorityScore - a.priorityScore);

  // Step 3: Dispatch resources to clusters
  for (const { items: clusterItems } of scoredClusters) {
    for (const req of clusterItems) {
      if (!remainingRequests.has(req.id)) continue;

      // Find the best resource that can serve this request with minimum arrival time
      let bestResId: string | null = null;
      let earliestArrival = Number.POSITIVE_INFINITY;
      let bestEstimate = { distanceKm: 0, durationMinutes: 0 };

      for (const res of availableResources) {
        const state = routesByResource.get(res.id)!;
        const availableCap = res.capacity - state.currentLoad;

        if (req.peopleCount <= availableCap) {
          const estimate = provider.getTravelEstimate(state.currentLocation, req, res.speedKmH);
          const arrival = state.currentMinutes + estimate.durationMinutes;

          if (arrival < earliestArrival && arrival < maxShiftMinutes) {
            earliestArrival = arrival;
            bestResId = res.id;
            bestEstimate = estimate;
          }
        }
      }

      // If no vehicle had immediate capacity, pick the vehicle with closest arrival after dropping off at a shelter
      if (!bestResId && req.peopleCount <= Math.max(...availableResources.map((r) => r.capacity))) {
        for (const res of availableResources) {
          if (req.peopleCount > res.capacity) continue;
          const state = routesByResource.get(res.id)!;

          // Compute detour to drop off at shelter then go to request
          if (state.currentLoad > 0) {
            let nearestShelter = shelters[0]!;
            let minShelterDist = Number.POSITIVE_INFINITY;
            for (const sh of shelters) {
              const d = provider.getTravelEstimate(
                state.currentLocation,
                sh,
                res.speedKmH,
              ).distanceKm;
              if (d < minShelterDist) {
                minShelterDist = d;
                nearestShelter = sh;
              }
            }

            const shelterEst = provider.getTravelEstimate(
              state.currentLocation,
              nearestShelter,
              res.speedKmH,
            );
            const reqEst = provider.getTravelEstimate(nearestShelter, req, res.speedKmH);
            const arrival =
              state.currentMinutes + shelterEst.durationMinutes + reqEst.durationMinutes;

            if (arrival < earliestArrival && arrival < maxShiftMinutes) {
              earliestArrival = arrival;
              bestResId = res.id;
            }
          }
        }
      }

      if (bestResId) {
        const res = availableResources.find((r) => r.id === bestResId)!;
        const state = routesByResource.get(bestResId)!;

        // If vehicle needs to unload first
        if (state.currentLoad + req.peopleCount > res.capacity && state.currentLoad > 0) {
          let nearestShelter = shelters[0]!;
          let minShelterDist = Number.POSITIVE_INFINITY;
          for (const sh of shelters) {
            const d = provider.getTravelEstimate(
              state.currentLocation,
              sh,
              res.speedKmH,
            ).distanceKm;
            if (d < minShelterDist) {
              minShelterDist = d;
              nearestShelter = sh;
            }
          }

          const shelterEst = provider.getTravelEstimate(
            state.currentLocation,
            nearestShelter,
            res.speedKmH,
          );
          state.currentMinutes += shelterEst.durationMinutes;
          state.currentDistanceKm += shelterEst.distanceKm;
          state.currentLocation = { lat: nearestShelter.lat, lng: nearestShelter.lng };

          state.routeStops.push({
            stopNumber: state.stopCounter++,
            type: 'DROPOFF',
            targetId: nearestShelter.id,
            lat: nearestShelter.lat,
            lng: nearestShelter.lng,
            passengersPickedUp: 0,
            passengersDroppedOff: state.currentLoad,
            estimatedArrivalMinutes: Number(state.currentMinutes.toFixed(2)),
          });

          state.currentLoad = 0;
          bestEstimate = provider.getTravelEstimate(state.currentLocation, req, res.speedKmH);
        }

        // Add pickup stop
        state.currentMinutes += bestEstimate.durationMinutes;
        state.currentDistanceKm += bestEstimate.distanceKm;
        state.currentLoad += req.peopleCount;
        state.currentLocation = { lat: req.lat, lng: req.lng };

        state.routeStops.push({
          stopNumber: state.stopCounter++,
          type: 'PICKUP',
          targetId: req.id,
          lat: req.lat,
          lng: req.lng,
          passengersPickedUp: req.peopleCount,
          passengersDroppedOff: 0,
          estimatedArrivalMinutes: Number(state.currentMinutes.toFixed(2)),
        });

        state.servedIds.push(req.id);
        remainingRequests.delete(req.id);
      }
    }
  }

  // Final dropoff at nearest shelter for any vehicle carrying passengers
  for (const res of availableResources) {
    const state = routesByResource.get(res.id)!;
    if (state.currentLoad > 0) {
      let nearestShelter = shelters[0]!;
      let minShelterDist = Number.POSITIVE_INFINITY;
      for (const sh of shelters) {
        const d = provider.getTravelEstimate(state.currentLocation, sh, res.speedKmH).distanceKm;
        if (d < minShelterDist) {
          minShelterDist = d;
          nearestShelter = sh;
        }
      }

      const shelterEst = provider.getTravelEstimate(
        state.currentLocation,
        nearestShelter,
        res.speedKmH,
      );
      state.currentMinutes += shelterEst.durationMinutes;
      state.currentDistanceKm += shelterEst.distanceKm;

      state.routeStops.push({
        stopNumber: state.stopCounter,
        type: 'DROPOFF',
        targetId: nearestShelter.id,
        lat: nearestShelter.lat,
        lng: nearestShelter.lng,
        passengersPickedUp: 0,
        passengersDroppedOff: state.currentLoad,
        estimatedArrivalMinutes: Number(state.currentMinutes.toFixed(2)),
      });

      state.currentLoad = 0;
    }
  }

  const finalRoutes: ResourceRoute[] = [];
  for (const res of availableResources) {
    const state = routesByResource.get(res.id)!;
    if (state.routeStops.length > 0) {
      finalRoutes.push({
        resourceId: res.id,
        stops: state.routeStops,
        totalTravelDistanceKm: Number(state.currentDistanceKm.toFixed(2)),
        totalDurationMinutes: Number(state.currentMinutes.toFixed(2)),
        servedRequestIds: state.servedIds,
      });
    }
  }

  for (const [id, req] of remainingRequests.entries()) {
    unservedList.push({
      requestId: id,
      reason: 'CAPACITY_EXCEEDED',
      details: `Request for ${req.peopleCount} people could not be scheduled within shift constraints`,
    });
  }

  const duration = Date.now() - startTime;
  const metrics = calculatePlanMetrics(
    scenario,
    { routes: finalRoutes, unserved: unservedList },
    duration,
  );

  return {
    scenarioId: scenario.id,
    calculatedAt: new Date().toISOString(),
    routes: finalRoutes,
    unserved: unservedList,
    metrics,
  };
}
