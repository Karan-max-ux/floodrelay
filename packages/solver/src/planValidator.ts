import {
  type GeoPoint,
  type Scenario,
  type SolverPlan,
  VALID_UNSERVED_REASONS,
  type ValidationResult,
} from '@floodrelay/shared';
import { StraightLineTravelTimeProvider, type TravelTimeProvider } from './routing/travelTime.js';

export interface PlanValidationOptions {
  maxShiftMinutes?: number;
  allowFrozen?: boolean;
  toleranceMinutes?: number;
  distanceToleranceKm?: number;
  travelTimeProvider?: TravelTimeProvider;
}

/**
 * Validates a SolverPlan independently against scenario constraints, physics invariants,
 * and reported metric consistency.
 *
 * Verifies:
 * - Duplicate resource routes are rejected.
 * - Resource availability (no offline/maintenance assignments).
 * - Continuous capacity bounds at every stop (never < 0, never > capacity).
 * - Pickup-to-delivery passenger accounting (correct counts, drops off before route end).
 * - Route termination at a valid shelter.
 * - Stop arrival times against physically possible travel durations.
 * - Recomputed route travel distance and duration match reported totals.
 * - Monotonicity and shift duration bounds.
 * - Single-assignment uniqueness and complete request accounting.
 * - Valid unserved reasons.
 * - Frozen stop/route invariants.
 */
export function validateSolverPlan(
  scenario: Scenario,
  plan: SolverPlan,
  options?: PlanValidationOptions,
): ValidationResult {
  const errors: string[] = [];
  const maxShiftMinutes = options?.maxShiftMinutes ?? 480;
  const allowFrozen = options?.allowFrozen ?? false;
  const toleranceMinutes = options?.toleranceMinutes ?? 0.1;
  const distanceToleranceKm = options?.distanceToleranceKm ?? 0.2;

  const travelProvider = options?.travelTimeProvider ?? new StraightLineTravelTimeProvider();

  // 1. Frozen routes / stops invariant
  if (!allowFrozen) {
    if (
      Array.isArray((scenario as { existingFrozenRoutes?: unknown[] }).existingFrozenRoutes) &&
      (scenario as { existingFrozenRoutes?: unknown[] }).existingFrozenRoutes!.length > 0
    ) {
      errors.push('Scenario contains existingFrozenRoutes, but frozen routes are not allowed');
    }
    for (const req of scenario.requests) {
      if (req.status && ['ASSIGNED', 'IN_TRANSIT', 'RESCUED'].includes(req.status)) {
        errors.push(
          `Request '${req.id}' has pre-assigned status '${req.status}', but frozen assignments are not allowed`,
        );
      }
    }
  }

  // Lookup maps
  const resourceMap = new Map(scenario.resources.map((r) => [r.id, r]));
  const requestMap = new Map(scenario.requests.map((req) => [req.id, req]));
  const shelterIds = new Set(scenario.shelters.map((s) => s.id));

  const allServedIds = new Set<string>();
  const seenResourceIds = new Set<string>();

  for (const route of plan.routes) {
    // 2. Reject duplicate resource routes
    if (seenResourceIds.has(route.resourceId)) {
      errors.push(
        `Duplicate route for resource '${route.resourceId}': resource is assigned more than once`,
      );
    }
    seenResourceIds.add(route.resourceId);

    // 3. Resource validation
    const resource = resourceMap.get(route.resourceId);
    if (!resource) {
      errors.push(`Route references unknown resource '${route.resourceId}'`);
      continue;
    }
    if (resource.status === 'MAINTENANCE' || resource.status === 'OFFLINE') {
      errors.push(
        `Resource '${resource.id}' is unavailable (status: ${resource.status}) but was assigned a route`,
      );
    }

    // 4. Shift duration limit
    if (route.totalDurationMinutes > maxShiftMinutes + toleranceMinutes) {
      errors.push(
        `Route for resource '${resource.id}' exceeds max shift limit: ${route.totalDurationMinutes.toFixed(2)} min > ${maxShiftMinutes} min`,
      );
    }

    // 5. Stops invariants & physical travel time recomputation
    let currentLoad = 0;
    let prevArrival = 0; // vehicle starts at t = 0
    let prevLocation: GeoPoint = { lat: resource.lat, lng: resource.lng };
    let recomputedDistanceKm = 0;
    let recomputedDurationMin = 0;

    const routePickups = new Set<string>();
    const onboardRequests = new Set<string>();

    for (let i = 0; i < route.stops.length; i++) {
      const stop = route.stops[i]!;

      if (!allowFrozen && stop.isFrozen) {
        errors.push(
          `Route for resource '${resource.id}' contains frozen stop ${stop.stopNumber}, which is not allowed`,
        );
      }

      // Check arrival time monotonicity
      if (stop.estimatedArrivalMinutes < prevArrival - 1e-4) {
        errors.push(
          `Route for resource '${resource.id}' stop ${stop.stopNumber} arrival time (${stop.estimatedArrivalMinutes}) is earlier than previous stop (${prevArrival})`,
        );
      }

      // Recompute physical travel estimate for this leg
      const legEstimate = travelProvider.getTravelEstimate(
        prevLocation,
        { lat: stop.lat, lng: stop.lng },
        resource.speedKmH,
        undefined,
        resource.type,
      );
      if (legEstimate.blocked && !Number.isFinite(legEstimate.durationMinutes)) {
        errors.push(
          `Route for resource '${resource.id}' leg to stop ${stop.stopNumber} crosses an impassable hazard zone under INFINITE policy`,
        );
      }
      recomputedDistanceKm += legEstimate.distanceKm;
      recomputedDurationMin += legEstimate.durationMinutes;

      // Validate arrival time against physical travel possibilities
      const minPossibleArrival = prevArrival + legEstimate.durationMinutes;
      if (stop.estimatedArrivalMinutes < minPossibleArrival - toleranceMinutes) {
        errors.push(
          `Route for resource '${resource.id}' stop ${stop.stopNumber} arrival time (${stop.estimatedArrivalMinutes.toFixed(2)} min) ` +
            `is physically impossible (minimum travel duration from previous location is ${legEstimate.durationMinutes.toFixed(2)} min, ` +
            `earliest possible arrival: ${minPossibleArrival.toFixed(2)} min)`,
        );
      }

      prevArrival = stop.estimatedArrivalMinutes;
      prevLocation = { lat: stop.lat, lng: stop.lng };

      if (stop.type === 'PICKUP') {
        const req = requestMap.get(stop.targetId);
        if (!req) {
          errors.push(
            `Route for resource '${resource.id}' pickup references unknown request '${stop.targetId}'`,
          );
        } else {
          if (routePickups.has(stop.targetId)) {
            errors.push(
              `Request '${stop.targetId}' is picked up multiple times in route '${resource.id}'`,
            );
          }
          routePickups.add(stop.targetId);

          if (allServedIds.has(stop.targetId)) {
            errors.push(`Request '${stop.targetId}' is served across multiple routes`);
          }
          allServedIds.add(stop.targetId);

          if (stop.passengersPickedUp !== req.peopleCount) {
            errors.push(
              `Route for resource '${resource.id}' stop ${stop.stopNumber} picked up ${stop.passengersPickedUp} passengers, expected ${req.peopleCount}`,
            );
          }
          onboardRequests.add(stop.targetId);
        }

        currentLoad += stop.passengersPickedUp ?? 0;
      } else if (stop.type === 'DROPOFF') {
        if (!shelterIds.has(stop.targetId)) {
          errors.push(
            `Route for resource '${resource.id}' dropoff target '${stop.targetId}' is not a recognized shelter`,
          );
        }
        if ((stop.passengersDroppedOff ?? 0) <= 0) {
          errors.push(
            `Route for resource '${resource.id}' stop ${stop.stopNumber} has invalid passengersDroppedOff (${stop.passengersDroppedOff})`,
          );
        }
        if ((stop.passengersDroppedOff ?? 0) > currentLoad) {
          errors.push(
            `Route for resource '${resource.id}' stop ${stop.stopNumber} dropped off ${stop.passengersDroppedOff} passengers, but only ${currentLoad} were onboard`,
          );
        }
        currentLoad -= stop.passengersDroppedOff ?? 0;
        // When vehicle empties all passengers at shelter
        if (currentLoad === 0) {
          onboardRequests.clear();
        }
      }

      // Continuous capacity check
      if (currentLoad < 0) {
        errors.push(
          `Route for resource '${resource.id}' passenger load dropped below 0 at stop ${stop.stopNumber} (${currentLoad})`,
        );
      }
      if (currentLoad > resource.capacity) {
        errors.push(
          `Route for resource '${resource.id}' passenger load (${currentLoad}) exceeded vehicle capacity (${resource.capacity}) at stop ${stop.stopNumber}`,
        );
      }
    }

    // 6. Must drop off all passengers before route end
    if (currentLoad !== 0) {
      errors.push(
        `Route for resource '${resource.id}' finished with ${currentLoad} passengers still onboard (not 0)`,
      );
    }
    if (onboardRequests.size !== 0) {
      errors.push(
        `Route for resource '${resource.id}' ended with undelivered requests onboard: ${[...onboardRequests].join(', ')}`,
      );
    }

    // 7. Non-empty route must end with a DROPOFF at a valid shelter
    if (route.stops.length > 0) {
      const lastStop = route.stops[route.stops.length - 1]!;
      if (lastStop.type !== 'DROPOFF' || !shelterIds.has(lastStop.targetId)) {
        errors.push(
          `Route for resource '${resource.id}' must end with a DROPOFF stop at a valid shelter (found type=${lastStop.type}, targetId=${lastStop.targetId})`,
        );
      }
      if (lastStop.estimatedArrivalMinutes > route.totalDurationMinutes + toleranceMinutes) {
        errors.push(
          `Route for resource '${resource.id}' final stop arrival (${lastStop.estimatedArrivalMinutes.toFixed(2)}) exceeds route totalDurationMinutes (${route.totalDurationMinutes.toFixed(2)})`,
        );
      }

      // Verify reported totals against recomputed physical totals
      const distDiff = Math.abs(route.totalTravelDistanceKm - recomputedDistanceKm);
      const maxAllowedDistDiff = Math.max(distanceToleranceKm, recomputedDistanceKm * 0.02);
      if (distDiff > maxAllowedDistDiff) {
        errors.push(
          `Route for resource '${resource.id}' reported totalTravelDistanceKm (${route.totalTravelDistanceKm}) ` +
            `inconsistent with recomputed stops distance (${recomputedDistanceKm.toFixed(2)} km, diff: ${distDiff.toFixed(2)} km)`,
        );
      }

      const durDiff = Math.abs(route.totalDurationMinutes - recomputedDurationMin);
      const maxAllowedDurDiff = Math.max(toleranceMinutes * 2, recomputedDurationMin * 0.02);
      if (durDiff > maxAllowedDurDiff) {
        errors.push(
          `Route for resource '${resource.id}' reported totalDurationMinutes (${route.totalDurationMinutes}) ` +
            `inconsistent with recomputed stops duration (${recomputedDurationMin.toFixed(2)} min, diff: ${durDiff.toFixed(2)} min)`,
        );
      }

      // Explicitly check applicable shift limit against independently recomputed duration
      if (recomputedDurationMin > maxShiftMinutes + toleranceMinutes) {
        errors.push(
          `Route for resource '${resource.id}' independently recomputed duration exceeds max shift limit: ${recomputedDurationMin.toFixed(2)} min > ${maxShiftMinutes} min`,
        );
      }
    }

    // 8. Check servedRequestIds consistency with pickups
    const servedSet = new Set(route.servedRequestIds);
    if (
      servedSet.size !== routePickups.size ||
      [...routePickups].some((id) => !servedSet.has(id))
    ) {
      errors.push(
        `Route for resource '${resource.id}' servedRequestIds does not match actual pickup stops`,
      );
    }
  }

  // 9. Unserved requests consistency
  const unservedIds = new Set<string>();
  for (const unserved of plan.unserved) {
    if (unservedIds.has(unserved.requestId)) {
      errors.push(`Duplicate unserved request entry for '${unserved.requestId}'`);
    }
    unservedIds.add(unserved.requestId);
    if (allServedIds.has(unserved.requestId)) {
      errors.push(`Request '${unserved.requestId}' is listed as both served and unserved`);
    }
    if (!requestMap.has(unserved.requestId)) {
      errors.push(`Unserved list references unknown request '${unserved.requestId}'`);
    }
    if (!VALID_UNSERVED_REASONS.has(unserved.reason)) {
      errors.push(
        `Unserved request '${unserved.requestId}' has invalid reason '${String(unserved.reason)}'`,
      );
    }
  }

  // 10. Completeness check
  for (const req of scenario.requests) {
    if (!allServedIds.has(req.id) && !unservedIds.has(req.id)) {
      errors.push(`Request '${req.id}' is neither served nor listed as unserved`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Asserts that a SolverPlan satisfies all scenario constraints, physics invariants,
 * and reported metric consistency.
 * Throws a descriptive Error listing all violations if validation fails.
 */
export function assertValidSolverPlan(
  scenario: Scenario,
  plan: SolverPlan,
  options?: PlanValidationOptions,
): void {
  const result = validateSolverPlan(scenario, plan, options);
  if (!result.valid) {
    throw new Error(`Plan validation failed:\n  - ${result.errors.join('\n  - ')}`);
  }
}
