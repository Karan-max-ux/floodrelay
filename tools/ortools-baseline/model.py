"""Data models, constants, and geographic calculation utilities for FloodRelay OR-Tools baseline."""

from __future__ import annotations

import math
from typing import Any, TypedDict

EARTH_RADIUS_KM = 6371.0
ASSUMED_ROAD_DETOUR_FACTOR = 1.3
ASSUMED_DEFAULT_SPEED_KMH = 30.0
ASSUMED_FLOOD_IMPEDANCE_MULTIPLIER = 1.5


class GeoPoint(TypedDict):
    lat: float
    lng: float


class RouteStop(TypedDict, total=False):
    stopNumber: int
    type: str  # 'PICKUP' | 'DROPOFF'
    targetId: str
    lat: float
    lng: float
    passengersPickedUp: int
    passengersDroppedOff: int
    estimatedArrivalMinutes: float
    isFrozen: bool


class ResourceRoute(TypedDict):
    resourceId: str
    stops: list[RouteStop]
    totalTravelDistanceKm: float
    totalDurationMinutes: float
    servedRequestIds: list[str]


class UnservedRequest(TypedDict, total=False):
    requestId: str
    reason: str
    details: str


class SolverMetrics(TypedDict):
    coveragePercent: float
    totalTravelTimeMinutes: float
    totalTravelDistanceKm: float
    highPriorityWaitTimeMinutes: float
    criticalWaitTimeMinutes: float
    averageWaitTimeMinutes: float
    maxWaitTimeMinutes: float
    solveDurationMs: int
    servedRequestsCount: int
    unservedRequestsCount: int
    totalRequestsCount: int


class SolverPlan(TypedDict, total=False):
    scenarioId: str
    calculatedAt: str
    solverStatus: str
    routes: list[ResourceRoute]
    unserved: list[UnservedRequest]
    metrics: SolverMetrics


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Computes the geodesic distance in km between two WGS-84 coordinates."""
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    r_lat1 = math.radians(lat1)
    r_lat2 = math.radians(lat2)
    h = (
        math.sin(d_lat / 2.0) ** 2
        + math.cos(r_lat1) * math.cos(r_lat2) * (math.sin(d_lng / 2.0) ** 2)
    )
    c = 2.0 * math.atan2(math.sqrt(h), math.sqrt(max(0.0, 1.0 - h)))
    return EARTH_RADIUS_KM * c


def get_travel_estimate(
    lat1: float,
    lng1: float,
    lat2: float,
    lng2: float,
    speed_kmh: float = ASSUMED_DEFAULT_SPEED_KMH,
    is_flooded: bool = False,
) -> tuple[float, float]:
    """Computes travel distance (km) and travel duration (minutes)."""
    raw_dist = haversine_km(lat1, lng1, lat2, lng2)
    impedance = ASSUMED_FLOOD_IMPEDANCE_MULTIPLIER if is_flooded else 1.0
    dist_km = round(raw_dist * ASSUMED_ROAD_DETOUR_FACTOR * impedance, 3)
    speed = (
        speed_kmh
        if speed_kmh is not None and speed_kmh > 0
        else ASSUMED_DEFAULT_SPEED_KMH
    )
    duration_min = round((dist_km / speed) * 60.0, 2)
    return dist_km, duration_min


def calculate_metrics(
    scenario: dict[str, Any],
    routes: list[ResourceRoute],
    unserved: list[UnservedRequest],
    solve_duration_ms: int = 0,
) -> SolverMetrics:
    """Calculates plan metrics in exact parity with packages/solver/src/metrics.ts."""
    requests = scenario.get("requests", [])
    requests_by_id = {r["id"]: r for r in requests}
    total_requests_count = len(requests)

    served_request_ids: set[str] = set()
    wait_times: list[float] = []
    high_priority_waits: list[float] = []
    critical_waits: list[float] = []

    total_travel_distance_km = 0.0
    total_travel_time_minutes = 0.0

    for route in routes:
        total_travel_distance_km += route.get("totalTravelDistanceKm", 0.0)
        total_travel_time_minutes += route.get("totalDurationMinutes", 0.0)

        for stop in route.get("stops", []):
            if stop.get("type") == "PICKUP" and stop.get("targetId"):
                target_id = stop["targetId"]
                served_request_ids.add(target_id)
                req = requests_by_id.get(target_id)
                if req:
                    wait_time = max(0.0, float(stop.get("estimatedArrivalMinutes", 0.0)))
                    wait_times.append(wait_time)
                    urgency = req.get("urgency", "LOW")
                    if urgency in ("HIGH", "CRITICAL"):
                        high_priority_waits.append(wait_time)
                    if urgency == "CRITICAL":
                        critical_waits.append(wait_time)

    served_count = len(served_request_ids)
    unserved_count = max(0, total_requests_count - served_count)
    coverage_percent = (
        100.0
        if total_requests_count == 0
        else round((served_count / total_requests_count) * 100.0, 2)
    )

    def avg(arr: list[float]) -> float:
        return 0.0 if not arr else round(sum(arr) / len(arr), 2)

    def max_val(arr: list[float]) -> float:
        return 0.0 if not arr else round(max(arr), 2)

    return {
        "coveragePercent": coverage_percent,
        "totalTravelTimeMinutes": round(total_travel_time_minutes, 2),
        "totalTravelDistanceKm": round(total_travel_distance_km, 2),
        "highPriorityWaitTimeMinutes": avg(high_priority_waits),
        "criticalWaitTimeMinutes": avg(critical_waits),
        "averageWaitTimeMinutes": avg(wait_times),
        "maxWaitTimeMinutes": max_val(wait_times),
        "solveDurationMs": solve_duration_ms,
        "servedRequestsCount": served_count,
        "unservedRequestsCount": unserved_count,
        "totalRequestsCount": total_requests_count,
    }
