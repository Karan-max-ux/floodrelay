import type {
  ResourceRoute,
  RouteStop,
  Scenario,
  SolverPlan,
  UnservedRequest,
} from '@floodrelay/shared';
import { calculatePlanMetrics } from '../metrics.js';
import { StraightLineTravelTimeProvider, type TravelTimeProvider } from '../routing/travelTime.js';

export interface NearestFirstOptions {
  travelTimeProvider?: TravelTimeProvider;
  maxShiftDurationMinutes?: number;
}

/**
 * Nearest-first greedy baseline solver.
 * Resources iteratively pick up the closest remaining request that fits capacity,
 * unloading at the nearest safe shelter when full or when no further requests can be added.
 */
export function solveNearestFirst(scenario: Scenario, options?: NearestFirstOptions): SolverPlan {
  const startTime = Date.now();
  const provider = options?.travelTimeProvider ?? new StraightLineTravelTimeProvider();
  const maxShiftMinutes = options?.maxShiftDurationMinutes ?? 480; // 8-hour shift default

  const unservedRequests = new Map(scenario.requests.map((r) => [r.id, r]));
  const routes: ResourceRoute[] = [];
  const unservedList: UnservedRequest[] = [];

  const availableResources = scenario.resources.filter(
    (r) => r.status === 'AVAILABLE' || r.status === 'ASSIGNED',
  );

  const shelters = scenario.shelters;

  if (shelters.length === 0 || availableResources.length === 0) {
    for (const req of scenario.requests) {
      unservedList.push({
        requestId: req.id,
        reason: shelters.length === 0 ? 'NO_REACHABLE_RESOURCE' : 'CAPACITY_EXCEEDED',
        details:
          shelters.length === 0
            ? 'No safe shelters available in scenario'
            : 'No available rescue resources',
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

  for (const resource of availableResources) {
    if (unservedRequests.size === 0) break;

    let currentLocation = { lat: resource.lat, lng: resource.lng };
    let currentMinutes = 0;
    let currentDistanceKm = 0;
    let currentLoad = 0;
    let stopCounter = 1;

    const routeStops: RouteStop[] = [];
    const servedIds: string[] = [];

    while (unservedRequests.size > 0 && currentMinutes < maxShiftMinutes) {
      const remainingCapacity = resource.capacity - currentLoad;

      // Find nearest request that fits in remaining vehicle capacity
      let nearestReqId: string | null = null;
      let minDistance = Number.POSITIVE_INFINITY;

      for (const [reqId, req] of unservedRequests.entries()) {
        if (req.peopleCount <= remainingCapacity) {
          const estimate = provider.getTravelEstimate(currentLocation, req, resource.speedKmH);
          if (estimate.distanceKm < minDistance) {
            minDistance = estimate.distanceKm;
            nearestReqId = reqId;
          }
        }
      }

      if (nearestReqId) {
        const req = unservedRequests.get(nearestReqId)!;
        const estimate = provider.getTravelEstimate(currentLocation, req, resource.speedKmH);

        // Check if travel would exceed shift limit
        if (currentMinutes + estimate.durationMinutes > maxShiftMinutes) {
          break;
        }

        currentMinutes += estimate.durationMinutes;
        currentDistanceKm += estimate.distanceKm;
        currentLoad += req.peopleCount;
        currentLocation = { lat: req.lat, lng: req.lng };

        routeStops.push({
          stopNumber: stopCounter++,
          type: 'PICKUP',
          targetId: req.id,
          lat: req.lat,
          lng: req.lng,
          passengersPickedUp: req.peopleCount,
          passengersDroppedOff: 0,
          estimatedArrivalMinutes: Number(currentMinutes.toFixed(2)),
        });

        servedIds.push(req.id);
        unservedRequests.delete(nearestReqId);
      } else {
        // No candidate fits or vehicle is full -> drop off at nearest shelter
        if (currentLoad > 0) {
          let nearestShelter = shelters[0]!;
          let minShelterDist = Number.POSITIVE_INFINITY;

          for (const shelter of shelters) {
            const dist = provider.getTravelEstimate(
              currentLocation,
              shelter,
              resource.speedKmH,
            ).distanceKm;
            if (dist < minShelterDist) {
              minShelterDist = dist;
              nearestShelter = shelter;
            }
          }

          const shelterEstimate = provider.getTravelEstimate(
            currentLocation,
            nearestShelter,
            resource.speedKmH,
          );
          currentMinutes += shelterEstimate.durationMinutes;
          currentDistanceKm += shelterEstimate.distanceKm;
          currentLocation = { lat: nearestShelter.lat, lng: nearestShelter.lng };

          routeStops.push({
            stopNumber: stopCounter++,
            type: 'DROPOFF',
            targetId: nearestShelter.id,
            lat: nearestShelter.lat,
            lng: nearestShelter.lng,
            passengersPickedUp: 0,
            passengersDroppedOff: currentLoad,
            estimatedArrivalMinutes: Number(currentMinutes.toFixed(2)),
          });

          currentLoad = 0;
        } else {
          // Empty vehicle cannot serve any remaining requests due to individual request sizes exceeding capacity
          break;
        }
      }
    }

    // Final drop-off at nearest shelter if carrying passengers at end of shift
    if (currentLoad > 0) {
      let nearestShelter = shelters[0]!;
      let minShelterDist = Number.POSITIVE_INFINITY;
      for (const shelter of shelters) {
        const dist = provider.getTravelEstimate(
          currentLocation,
          shelter,
          resource.speedKmH,
        ).distanceKm;
        if (dist < minShelterDist) {
          minShelterDist = dist;
          nearestShelter = shelter;
        }
      }
      const shelterEstimate = provider.getTravelEstimate(
        currentLocation,
        nearestShelter,
        resource.speedKmH,
      );
      currentMinutes += shelterEstimate.durationMinutes;
      currentDistanceKm += shelterEstimate.distanceKm;

      routeStops.push({
        stopNumber: stopCounter,
        type: 'DROPOFF',
        targetId: nearestShelter.id,
        lat: nearestShelter.lat,
        lng: nearestShelter.lng,
        passengersPickedUp: 0,
        passengersDroppedOff: currentLoad,
        estimatedArrivalMinutes: Number(currentMinutes.toFixed(2)),
      });
    }

    if (routeStops.length > 0) {
      routes.push({
        resourceId: resource.id,
        stops: routeStops,
        totalTravelDistanceKm: Number(currentDistanceKm.toFixed(2)),
        totalDurationMinutes: Number(currentMinutes.toFixed(2)),
        servedRequestIds: servedIds,
      });
    }
  }

  // Any remaining requests are marked unserved
  for (const [id, req] of unservedRequests.entries()) {
    unservedList.push({
      requestId: id,
      reason: 'CAPACITY_EXCEEDED',
      details: `Request of ${req.peopleCount} passengers could not be assigned within resource capacity or shift limits`,
    });
  }

  const duration = Date.now() - startTime;
  const metrics = calculatePlanMetrics(scenario, { routes, unserved: unservedList }, duration);

  return {
    scenarioId: scenario.id,
    calculatedAt: new Date().toISOString(),
    routes,
    unserved: unservedList,
    metrics,
  };
}
