import type { Scenario, SolverPlan, ValidationResult } from '@floodrelay/shared';

export interface PlanValidationOptions {
  maxShiftMinutes?: number;
  allowFrozen?: boolean;
  toleranceMinutes?: number;
}

/**
 * Validates a SolverPlan independently against scenario constraints and physics invariants.
 * Checks continuous capacity bounds, resource availability, single-assignment uniqueness,
 * mandatory shelter return, shift duration limits, arrival monotonicity, and frozen-stop invariants.
 */
export function validateSolverPlan(
  scenario: Scenario,
  plan: SolverPlan,
  options?: PlanValidationOptions,
): ValidationResult {
  const errors: string[] = [];
  const maxShiftMinutes = options?.maxShiftMinutes ?? 480;
  const allowFrozen = options?.allowFrozen ?? false;
  const toleranceMinutes = options?.toleranceMinutes ?? 0.05;

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

  for (const route of plan.routes) {
    // 2. Resource validation
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

    // 3. Shift duration limit
    if (route.totalDurationMinutes > maxShiftMinutes + toleranceMinutes) {
      errors.push(
        `Route for resource '${resource.id}' exceeds max shift limit: ${route.totalDurationMinutes.toFixed(2)} min > ${maxShiftMinutes} min`,
      );
    }

    // 4. Stops invariants
    let currentLoad = 0;
    let prevArrival = -1;
    const routePickups = new Set<string>();

    for (const stop of route.stops) {
      if (!allowFrozen && stop.isFrozen) {
        errors.push(
          `Route for resource '${resource.id}' contains frozen stop ${stop.stopNumber}, which is not allowed`,
        );
      }

      if (stop.estimatedArrivalMinutes < prevArrival - 1e-4) {
        errors.push(
          `Route for resource '${resource.id}' stop ${stop.stopNumber} arrival time (${stop.estimatedArrivalMinutes}) is earlier than previous stop (${prevArrival})`,
        );
      }
      prevArrival = stop.estimatedArrivalMinutes;

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
        }

        currentLoad += stop.passengersPickedUp ?? 0;
      } else if (stop.type === 'DROPOFF') {
        if (!shelterIds.has(stop.targetId)) {
          errors.push(
            `Route for resource '${resource.id}' dropoff target '${stop.targetId}' is not a recognized shelter`,
          );
        }
        currentLoad -= stop.passengersDroppedOff ?? 0;
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

    // 5. Must drop off all passengers before route end
    if (currentLoad !== 0) {
      errors.push(
        `Route for resource '${resource.id}' finished with ${currentLoad} passengers still onboard (not 0)`,
      );
    }

    // 6. Non-empty route must end with a DROPOFF at a valid shelter
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
    }

    // 7. Check servedRequestIds consistency with pickups
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

  // 8. Unserved requests consistency
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
  }

  // Completeness check
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
 * Asserts that a SolverPlan satisfies all scenario constraints and physics invariants.
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
