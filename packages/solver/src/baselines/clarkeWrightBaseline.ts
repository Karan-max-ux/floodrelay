import type {
  RescueRequest,
  ResourceRoute,
  RouteStop,
  Scenario,
  SolverPlan,
  UnservedRequest,
} from '@floodrelay/shared';
import { calculatePlanMetrics } from '../metrics.js';
import { StraightLineTravelTimeProvider, type TravelTimeProvider } from '../routing/travelTime.js';
import { hasFiniteRoundTrip } from '../routing/blockedZones.js';

export interface ClarkeWrightBaselineOptions {
  travelTimeProvider?: TravelTimeProvider;
  maxShiftMinutes?: number;
  max2OptIterations?: number;
}

/**
 * Clarke-Wright Savings heuristic with 2-opt local search (no time windows).
 * Multi-trip vehicle routing heuristic with depot reload support.
 */
export function solveClarkeWrightBaseline(
  scenario: Scenario,
  options?: ClarkeWrightBaselineOptions,
): SolverPlan {
  const startTime = Date.now();
  const provider = options?.travelTimeProvider ?? new StraightLineTravelTimeProvider();
  const maxShiftMinutes = options?.maxShiftMinutes ?? 480;
  const maxIterations = options?.max2OptIterations ?? 50;

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

  const primaryDepot = shelters[0]!;
  const unservedRequests = new Map(scenario.requests.map((r) => [r.id, r]));
  const finalRoutes: ResourceRoute[] = [];

  // Sort resources by capacity (largest resources first for high efficiency)
  const sortedResources = [...availableResources].sort((a, b) => b.capacity - a.capacity);

  for (const resource of sortedResources) {
    if (unservedRequests.size === 0) break;

    let currentLocation: { lat: number; lng: number } = { lat: resource.lat, lng: resource.lng };
    let currentMinutes = 0;
    let currentDistanceKm = 0;
    let stopCounter = 1;
    const stops: RouteStop[] = [];
    const servedIds: string[] = [];

    while (unservedRequests.size > 0 && currentMinutes < maxShiftMinutes) {
      // Step 1: Candidate selection for this trip based on vehicle capacity
      const candidates: RescueRequest[] = [];
      let currentCapacity = resource.capacity;

      // Prioritize critical and high urgency requests first
      const sortedPending = Array.from(unservedRequests.values()).sort((a, b) => {
        const urgencyScore = (u: string): number =>
          u === 'CRITICAL' ? 4 : u === 'HIGH' ? 3 : u === 'MEDIUM' ? 2 : 1;
        return urgencyScore(b.urgency) - urgencyScore(a.urgency);
      });

      for (const req of sortedPending) {
        if (req.peopleCount <= currentCapacity) {
          candidates.push(req);
          currentCapacity -= req.peopleCount;
        }
      }

      if (candidates.length === 0) break;

      // Step 2: Clarke-Wright Savings Construction
      let orderedPickups: RescueRequest[] = [];

      if (candidates.length <= 2) {
        orderedPickups = [...candidates];
      } else {
        interface SavingEdge {
          i: number;
          j: number;
          saving: number;
        }
        const savings: SavingEdge[] = [];

        for (let i = 0; i < candidates.length; i++) {
          const reqI = candidates[i]!;
          const dDepotI = provider.getTravelEstimate(
            primaryDepot,
            reqI,
            resource.speedKmH,
            undefined,
            resource.type,
          ).distanceKm;

          for (let j = i + 1; j < candidates.length; j++) {
            const reqJ = candidates[j]!;
            const dDepotJ = provider.getTravelEstimate(
              primaryDepot,
              reqJ,
              resource.speedKmH,
              undefined,
              resource.type,
            ).distanceKm;
            const dIJ = provider.getTravelEstimate(
              reqI,
              reqJ,
              resource.speedKmH,
              undefined,
              resource.type,
            ).distanceKm;
            const saving = dDepotI + dDepotJ - dIJ;
            if (Number.isFinite(saving)) {
              savings.push({ i, j, saving });
            }
          }
        }

        savings.sort((a, b) => b.saving - a.saving);

        const visited = new Set<number>();
        for (const edge of savings) {
          if (!visited.has(edge.i)) {
            visited.add(edge.i);
            orderedPickups.push(candidates[edge.i]!);
          }
          if (!visited.has(edge.j)) {
            visited.add(edge.j);
            orderedPickups.push(candidates[edge.j]!);
          }
        }

        for (let i = 0; i < candidates.length; i++) {
          if (!visited.has(i)) {
            orderedPickups.push(candidates[i]!);
          }
        }
      }

      // Step 3: 2-opt Local Search refinement on orderedPickups
      let improved = true;
      let iteration = 0;

      const routeDistance = (pts: RescueRequest[]): number => {
        let d = 0;
        let prev: { lat: number; lng: number } = currentLocation;
        for (const p of pts) {
          d += provider.getTravelEstimate(
            prev,
            p,
            resource.speedKmH,
            undefined,
            resource.type,
          ).distanceKm;
          prev = p;
        }
        d += provider.getTravelEstimate(
          prev,
          primaryDepot,
          resource.speedKmH,
          undefined,
          resource.type,
        ).distanceKm;
        return d;
      };

      while (improved && iteration < maxIterations) {
        improved = false;
        iteration++;

        for (let i = 0; i < orderedPickups.length - 1; i++) {
          for (let k = i + 1; k < orderedPickups.length; k++) {
            const newRoute = [
              ...orderedPickups.slice(0, i),
              ...orderedPickups.slice(i, k + 1).reverse(),
              ...orderedPickups.slice(k + 1),
            ];

            if (routeDistance(newRoute) < routeDistance(orderedPickups) - 1e-4) {
              orderedPickups = newRoute;
              improved = true;
              break;
            }
          }
          if (improved) break;
        }
      }

      // Step 4: Execute Pickups for this batch
      let currentLoad = 0;
      let tripPickups = 0;

      for (const req of orderedPickups) {
        const est = provider.getTravelEstimate(
          currentLocation,
          req,
          resource.speedKmH,
          undefined,
          resource.type,
        );
        if (est.blocked || !Number.isFinite(est.durationMinutes)) {
          continue;
        }
        let minShelterDuration = Number.POSITIVE_INFINITY;
        for (const sh of shelters) {
          const shelterEst = provider.getTravelEstimate(
            req,
            sh,
            resource.speedKmH,
            undefined,
            resource.type,
          );
          if (
            !shelterEst.blocked &&
            Number.isFinite(shelterEst.durationMinutes) &&
            shelterEst.durationMinutes < minShelterDuration
          ) {
            minShelterDuration = shelterEst.durationMinutes;
          }
        }
        if (!Number.isFinite(minShelterDuration)) {
          continue;
        }
        if (currentMinutes + est.durationMinutes + minShelterDuration > maxShiftMinutes) break;

        currentMinutes += est.durationMinutes;
        currentDistanceKm += est.distanceKm;
        currentLoad += req.peopleCount;
        currentLocation = { lat: req.lat, lng: req.lng };

        stops.push({
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
        unservedRequests.delete(req.id);
        tripPickups++;
      }

      // Dropoff at nearest shelter
      if (currentLoad > 0) {
        let bestShelter = shelters[0]!;
        let minShelterDist = Number.POSITIVE_INFINITY;
        for (const sh of shelters) {
          const shelterEst = provider.getTravelEstimate(
            currentLocation,
            sh,
            resource.speedKmH,
            undefined,
            resource.type,
          );
          if (
            !shelterEst.blocked &&
            Number.isFinite(shelterEst.distanceKm) &&
            shelterEst.distanceKm < minShelterDist
          ) {
            minShelterDist = shelterEst.distanceKm;
            bestShelter = sh;
          }
        }

        const shelterEst = provider.getTravelEstimate(
          currentLocation,
          bestShelter,
          resource.speedKmH,
          undefined,
          resource.type,
        );
        currentMinutes += shelterEst.durationMinutes;
        currentDistanceKm += shelterEst.distanceKm;
        currentLocation = { lat: bestShelter.lat, lng: bestShelter.lng };

        stops.push({
          stopNumber: stopCounter++,
          type: 'DROPOFF',
          targetId: bestShelter.id,
          lat: bestShelter.lat,
          lng: bestShelter.lng,
          passengersPickedUp: 0,
          passengersDroppedOff: currentLoad,
          estimatedArrivalMinutes: Number(currentMinutes.toFixed(2)),
        });
      }

      // If no pickups were made due to time or capacity limits, stop this vehicle
      if (tripPickups === 0) {
        break;
      }
    }

    if (stops.length > 0) {
      finalRoutes.push({
        resourceId: resource.id,
        stops,
        totalTravelDistanceKm: Number(currentDistanceKm.toFixed(2)),
        totalDurationMinutes: Number(currentMinutes.toFixed(2)),
        servedRequestIds: servedIds,
      });
    }
  }

  const maxResourceCapacity = Math.max(0, ...scenario.resources.map((r) => r.capacity));
  for (const [id, req] of unservedRequests.entries()) {
    const isTooLarge = req.peopleCount > maxResourceCapacity;
    const isHazardUnreachable =
      !isTooLarge && !hasFiniteRoundTrip(req, availableResources, shelters, provider);
    unservedList.push({
      requestId: id,
      reason: isTooLarge
        ? 'GROUP_LARGER_THAN_ANY_VEHICLE'
        : isHazardUnreachable
          ? 'UNREACHABLE_DUE_TO_HAZARD'
          : 'SHIFT_LIMIT_REACHED',
      details: isTooLarge
        ? `Request of ${req.peopleCount} passengers exceeds maximum vehicle capacity (${maxResourceCapacity})`
        : isHazardUnreachable
          ? `Request of ${req.peopleCount} passengers is unreachable due to active blocked hazard zones`
          : `Request of ${req.peopleCount} passengers could not be assigned within shift limits in Clarke-Wright baseline`,
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
