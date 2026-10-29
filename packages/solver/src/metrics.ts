import type {
  RescueRequest,
  RouteStop,
  Scenario,
  SolverMetrics,
  SolverPlan,
} from '@floodrelay/shared';

export interface DetailedMetrics extends SolverMetrics {
  totalRequestsCount: number;
  criticalWaitTimeMinutes: number;
  maxWaitTimeMinutes: number;
  averageWaitTimeMinutes: number;
}

export interface ChurnMetrics {
  previousServedCount: number;
  reassignedRequestsCount: number;
  churnPercent: number;
  frozenStopsViolated: number;
}

/**
 * Calculates standard benchmark evaluation metrics for a solver plan against a scenario.
 */
export function calculatePlanMetrics(
  scenario: Scenario,
  plan: Pick<SolverPlan, 'routes' | 'unserved'>,
  solveDurationMs = 0,
): DetailedMetrics {
  const requestsById = new Map<string, RescueRequest>();
  for (const req of scenario.requests) {
    requestsById.set(req.id, req);
  }

  const totalRequestsCount = scenario.requests.length;
  const servedRequestIds = new Set<string>();
  const waitTimesMinutes: number[] = [];
  const highPriorityWaitTimes: number[] = [];
  const criticalWaitTimes: number[] = [];

  let totalTravelDistanceKm = 0;
  let totalTravelTimeMinutes = 0;

  for (const route of plan.routes) {
    totalTravelDistanceKm += route.totalTravelDistanceKm;
    totalTravelTimeMinutes += route.totalDurationMinutes;

    for (const stop of route.stops) {
      if (stop.type === 'PICKUP' && stop.targetId) {
        servedRequestIds.add(stop.targetId);
        const req = requestsById.get(stop.targetId);
        if (req) {
          // Wait time from scenario base/request arrival to pickup arrival
          const waitTime = Math.max(0, stop.estimatedArrivalMinutes);
          waitTimesMinutes.push(waitTime);

          if (req.urgency === 'HIGH' || req.urgency === 'CRITICAL') {
            highPriorityWaitTimes.push(waitTime);
          }
          if (req.urgency === 'CRITICAL') {
            criticalWaitTimes.push(waitTime);
          }
        }
      }
    }
  }

  const servedRequestsCount = servedRequestIds.size;
  const unservedRequestsCount = Math.max(0, totalRequestsCount - servedRequestsCount);
  const coveragePercent =
    totalRequestsCount === 0
      ? 100
      : Number(((servedRequestsCount / totalRequestsCount) * 100).toFixed(2));

  const average = (arr: number[]): number =>
    arr.length === 0 ? 0 : Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2));

  const max = (arr: number[]): number =>
    arr.length === 0 ? 0 : Number(Math.max(...arr).toFixed(2));

  return {
    coveragePercent,
    totalTravelTimeMinutes: Number(totalTravelTimeMinutes.toFixed(2)),
    totalTravelDistanceKm: Number(totalTravelDistanceKm.toFixed(2)),
    highPriorityWaitTimeMinutes: average(highPriorityWaitTimes),
    criticalWaitTimeMinutes: average(criticalWaitTimes),
    averageWaitTimeMinutes: average(waitTimesMinutes),
    maxWaitTimeMinutes: max(waitTimesMinutes),
    solveDurationMs,
    servedRequestsCount,
    unservedRequestsCount,
    totalRequestsCount,
  };
}

/**
 * Calculates assignment churn between a previous committed plan and an updated plan.
 * Churn measures how many already-communicated request assignments were changed.
 */
export function calculateChurn(previousPlan: SolverPlan, updatedPlan: SolverPlan): ChurnMetrics {
  const previousAssignments = new Map<string, string>(); // requestId -> resourceId
  const frozenStops = new Map<string, RouteStop>(); // stopId / targetId -> stop

  for (const route of previousPlan.routes) {
    for (const stop of route.stops) {
      if (stop.type === 'PICKUP') {
        previousAssignments.set(stop.targetId, route.resourceId);
      }
      if (stop.isFrozen) {
        frozenStops.set(`${route.resourceId}:${stop.targetId}`, stop);
      }
    }
  }

  const updatedAssignments = new Map<string, string>();
  for (const route of updatedPlan.routes) {
    for (const stop of route.stops) {
      if (stop.type === 'PICKUP') {
        updatedAssignments.set(stop.targetId, route.resourceId);
      }
    }
  }

  let reassignedRequestsCount = 0;
  for (const [reqId, prevResId] of previousAssignments.entries()) {
    const updatedResId = updatedAssignments.get(reqId);
    if (updatedResId !== prevResId) {
      reassignedRequestsCount++;
    }
  }

  let frozenStopsViolated = 0;
  for (const [key, prevStop] of frozenStops.entries()) {
    const [resId, targetId] = key.split(':');
    const updatedRoute = updatedPlan.routes.find((r) => r.resourceId === resId);
    const updatedStop = updatedRoute?.stops.find((s) => s.targetId === targetId);

    if (!updatedStop || updatedStop.stopNumber !== prevStop.stopNumber) {
      frozenStopsViolated++;
    }
  }

  const previousServedCount = previousAssignments.size;
  const churnPercent =
    previousServedCount === 0
      ? 0
      : Number(((reassignedRequestsCount / previousServedCount) * 100).toFixed(2));

  return {
    previousServedCount,
    reassignedRequestsCount,
    churnPercent,
    frozenStopsViolated,
  };
}
