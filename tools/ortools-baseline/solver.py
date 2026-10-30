"""Google OR-Tools Optimization Baseline for FloodRelay.

Formulates flood rescue dispatch as a multi-vehicle pickup and delivery problem (PDP)
with capacity constraints, shift duration limits (enforcing the return leg to safe shelters),
and urgency-prioritized penalties.
Employs constraint programming and guided local search metaheuristics to find feasible,
high-quality solutions within configurable search time limits (heuristic/metaheuristic baseline;
does not prove global optimality on general VRP instances).
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
import sys
import time
from typing import Any

from ortools.constraint_solver import pywrapcp, routing_enums_pb2

try:
    from .model import (
        ResourceRoute,
        RouteStop,
        SolverPlan,
        UnservedRequest,
        calculate_metrics,
        get_travel_estimate,
        haversine_km,
    )
except ImportError:
    from model import (
        ResourceRoute,
        RouteStop,
        SolverPlan,
        UnservedRequest,
        calculate_metrics,
        get_travel_estimate,
        haversine_km,
    )



def solve(
    scenario: dict[str, Any],
    max_shift_minutes: float = 480.0,
    time_limit_seconds: float = 5.0,
) -> SolverPlan:
    """Solves the scenario using Google OR-Tools RoutingModel."""
    start_time = time.perf_counter()

    scenario_id = scenario.get("id", "scenario")
    requests = scenario.get("requests", [])
    resources = scenario.get("resources", [])
    shelters = scenario.get("shelters", [])

    available_resources = [
        r for r in resources if r.get("status") in ("AVAILABLE", "ASSIGNED")
    ]

    unserved_list: list[UnservedRequest] = []

    # Check for unsupported frozen stops or existing frozen routes (Task 2)
    if scenario.get("existingFrozenRoutes"):
        raise ValueError(
            "Google OR-Tools baseline is a static benchmark solver and does not "
            "support frozen stops or existing frozen routes. Use Cluster-Allocation "
            "for scenarios with committed frozen stops."
        )
    for req in requests:
        if req.get("status") in ("ASSIGNED", "IN_TRANSIT", "RESCUED"):
            raise ValueError(
                f"Google OR-Tools baseline does not support pre-assigned/frozen requests "
                f"(request '{req.get('id')}' has status '{req.get('status')}'). "
                "Use Cluster-Allocation for replanning with committed assignments."
            )

    # Edge case 1: No available resources or no safe shelters
    if not shelters or not available_resources:
        for req in requests:
            reason = "NO_REACHABLE_RESOURCE" if not shelters else "CAPACITY_EXCEEDED"
            details = (
                "No safe shelters available in scenario"
                if not shelters
                else "No available rescue resources"
            )
            unserved_list.append({
                "requestId": req["id"],
                "reason": reason,
                "details": details,
            })
        duration_ms = int((time.perf_counter() - start_time) * 1000)
        metrics = calculate_metrics(scenario, [], unserved_list, duration_ms)
        return {
            "scenarioId": scenario_id,
            "calculatedAt": datetime.now(timezone.utc).isoformat(),
            "routes": [],
            "unserved": unserved_list,
            "metrics": metrics,
        }

    # Edge case 2: Empty requests list
    if not requests:
        duration_ms = int((time.perf_counter() - start_time) * 1000)
        metrics = calculate_metrics(scenario, [], [], duration_ms)
        return {
            "scenarioId": scenario_id,
            "calculatedAt": datetime.now(timezone.utc).isoformat(),
            "routes": [],
            "unserved": [],
            "metrics": metrics,
        }

    # Capacity pre-check: Identify requests exceeding maximum vehicle capacity
    max_resource_capacity = max(
        (r.get("capacity", 0) for r in available_resources), default=0
    )
    candidate_requests: list[dict[str, Any]] = []

    for req in requests:
        people_count = req.get("peopleCount", 0)
        if people_count > max_resource_capacity:
            unserved_list.append({
                "requestId": req["id"],
                "reason": "GROUP_LARGER_THAN_ANY_VEHICLE",
                "details": (
                    f"Request of {people_count} passengers exceeds "
                    f"maximum vehicle capacity ({max_resource_capacity})"
                ),
            })
        else:
            candidate_requests.append(req)

    # If all requests were oversized
    if not candidate_requests:
        duration_ms = int((time.perf_counter() - start_time) * 1000)
        metrics = calculate_metrics(scenario, [], unserved_list, duration_ms)
        return {
            "scenarioId": scenario_id,
            "calculatedAt": datetime.now(timezone.utc).isoformat(),
            "routes": [],
            "unserved": unserved_list,
            "metrics": metrics,
        }

    # Assign nearest safe shelter destination for each candidate request
    req_shelters: list[dict[str, Any]] = []
    for req in candidate_requests:
        best_sh = min(
            shelters,
            key=lambda sh: haversine_km(
                req["lat"], req["lng"], sh["lat"], sh["lng"]
            ),
        )
        req_shelters.append(best_sh)

    N = len(candidate_requests)
    M = len(available_resources)

    # Node indexing:
    # 0 .. N-1: Pickup nodes P_i
    # N .. 2N-1: Delivery nodes D_i (at req_shelters[i])
    # 2N .. 2N+M-1: Vehicle start nodes
    # 2N+M .. 2N+2M-1: Vehicle end nodes
    total_nodes = 2 * N + 2 * M
    starts = [2 * N + k for k in range(M)]
    ends = [2 * N + M + k for k in range(M)]

    manager = pywrapcp.RoutingIndexManager(total_nodes, M, starts, ends)
    routing = pywrapcp.RoutingModel(manager)

    def get_node_coords(node_idx: int) -> tuple[float, float]:
        if node_idx < N:
            req = candidate_requests[node_idx]
            return float(req["lat"]), float(req["lng"])
        if node_idx < 2 * N:
            sh = req_shelters[node_idx - N]
            return float(sh["lat"]), float(sh["lng"])
        if node_idx < 2 * N + M:
            res = available_resources[node_idx - 2 * N]
            return float(res["lat"]), float(res["lng"])
        # End node: colocated with nearest shelter to vehicle start
        res = available_resources[node_idx - (2 * N + M)]
        sh = min(
            shelters,
            key=lambda s: haversine_km(
                res["lat"], res["lng"], s["lat"], s["lng"]
            ),
        )
        return float(sh["lat"]), float(sh["lng"])

    # Register vehicle-specific transit callbacks
    transit_callbacks: list[int] = []
    for k in range(M):
        res = available_resources[k]
        spd = float(res.get("speedKmH", 30.0))
        start_node = 2 * N + k
        end_node = 2 * N + M + k

        def make_cb(vehicle_speed: float, v_start: int, v_end: int):
            def transit_callback(from_idx: int, to_idx: int) -> int:
                fn = manager.IndexToNode(from_idx)
                tn = manager.IndexToNode(to_idx)
                if fn == tn:
                    return 0
                # Reaching end node from a shelter delivery is 0 cost/time
                if N <= fn < 2 * N and tn == v_end:
                    return 0
                # Idle vehicle transitioning directly from start to end has 0 cost/time
                if fn == v_start and tn == v_end:
                    return 0
                # Going directly from pickup to end is disallowed
                if fn < N and tn == v_end:
                    return 10_000_000
                # Moving to another vehicle's end node is disallowed
                if tn >= 2 * N + M and tn != v_end:
                    return 10_000_000

                lat1, lng1 = get_node_coords(fn)
                lat2, lng2 = get_node_coords(tn)
                if lat1 == lat2 and lng1 == lng2:
                    # Enforce strictly positive transit between a pickup and its own delivery if colocated
                    if fn < N and tn == N + fn:
                        return 1
                    return 0
                _, dur_min = get_travel_estimate(
                    lat1, lng1, lat2, lng2, vehicle_speed
                )
                return max(1, int(round(dur_min * 100)))

            return transit_callback

        cb_fn = make_cb(spd, start_node, end_node)
        cb_idx = routing.RegisterTransitCallback(cb_fn)
        transit_callbacks.append(cb_idx)
        routing.SetArcCostEvaluatorOfVehicle(cb_idx, k)

    # Time dimension: enforce vehicle shift limit including return leg to shelter
    time_scale_max = int(max_shift_minutes * 100)
    routing.AddDimensionWithVehicleTransits(
        transit_callbacks,
        0,
        time_scale_max * 10,
        True,
        "Time",
    )
    time_dim = routing.GetDimensionOrDie("Time")
    for k in range(M):
        time_dim.CumulVar(routing.End(k)).SetMax(time_scale_max)

    # Capacity dimension: cumulative passenger load
    def demand_callback(from_idx: int) -> int:
        fn = manager.IndexToNode(from_idx)
        if fn < N:
            return int(candidate_requests[fn].get("peopleCount", 0))
        if fn < 2 * N:
            return -int(candidate_requests[fn - N].get("peopleCount", 0))
        return 0

    demand_cb_idx = routing.RegisterUnaryTransitCallback(demand_callback)
    routing.AddDimensionWithVehicleCapacity(
        demand_cb_idx,
        0,
        [int(r.get("capacity", 0)) for r in available_resources],
        True,
        "Capacity",
    )

    # Penalties and urgency prioritization
    urgency_penalties = {
        "CRITICAL": 10_000_000,
        "HIGH": 5_000_000,
        "MEDIUM": 2_000_000,
        "LOW": 1_000_000,
    }
    urgency_wait_weights = {
        "CRITICAL": 200,
        "HIGH": 100,
        "MEDIUM": 20,
        "LOW": 5,
    }

    for i in range(N):
        p_idx = manager.NodeToIndex(i)
        d_idx = manager.NodeToIndex(N + i)
        routing.AddPickupAndDelivery(p_idx, d_idx)
        routing.solver().Add(
            routing.VehicleVar(p_idx) == routing.VehicleVar(d_idx)
        )
        routing.solver().Add(
            routing.ActiveVar(p_idx) == routing.ActiveVar(d_idx)
        )
        routing.solver().Add(
            time_dim.CumulVar(p_idx) <= time_dim.CumulVar(d_idx)
        )

        urg = candidate_requests[i].get("urgency", "LOW")
        penalty = urgency_penalties.get(urg, 1_000_000)
        routing.AddDisjunction([p_idx], penalty)
        routing.AddDisjunction([d_idx], 0)

        # Soft upper bound on pickup arrival time to prioritize high-urgency rescues
        wait_weight = urgency_wait_weights.get(urg, 5)
        time_dim.SetCumulVarSoftUpperBound(p_idx, 0, wait_weight)

    # Search parameters
    search_params = pywrapcp.DefaultRoutingSearchParameters()
    search_params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
    )
    search_params.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    seconds_int = int(math.floor(time_limit_seconds))
    nanos_int = int((time_limit_seconds - seconds_int) * 1e9)
    search_params.time_limit.seconds = max(1, seconds_int)
    if nanos_int > 0:
        search_params.time_limit.nanos = nanos_int

    solution = routing.SolveWithParameters(search_params)

    routes: list[ResourceRoute] = []
    served_ids: set[str] = set()

    if solution:
        for k in range(M):
            res = available_resources[k]
            spd = float(res.get("speedKmH", 30.0))
            index = routing.Start(k)
            route_nodes: list[int] = []

            while not routing.IsEnd(index):
                route_nodes.append(manager.IndexToNode(index))
                index = solution.Value(routing.NextVar(index))
            route_nodes.append(manager.IndexToNode(index))

            # Skip vehicles that remained idle (only visited start and end)
            if len(route_nodes) <= 2:
                continue

            stops: list[RouteStop] = []
            stop_counter = 1
            curr_lat = float(res["lat"])
            curr_lng = float(res["lng"])
            curr_min = 0.0
            curr_dist = 0.0
            route_served: list[str] = []

            # Process intermediate nodes between start and end
            for node in route_nodes[1:-1]:
                if node < N:
                    req = candidate_requests[node]
                    d_km, dur_min = get_travel_estimate(
                        curr_lat,
                        curr_lng,
                        float(req["lat"]),
                        float(req["lng"]),
                        spd,
                    )
                    curr_dist += d_km
                    curr_min += dur_min
                    curr_lat = float(req["lat"])
                    curr_lng = float(req["lng"])

                    stops.append({
                        "stopNumber": stop_counter,
                        "type": "PICKUP",
                        "targetId": req["id"],
                        "lat": req["lat"],
                        "lng": req["lng"],
                        "passengersPickedUp": int(req["peopleCount"]),
                        "passengersDroppedOff": 0,
                        "estimatedArrivalMinutes": round(curr_min, 2),
                    })
                    stop_counter += 1
                    route_served.append(req["id"])
                    served_ids.add(req["id"])
                elif node < 2 * N:
                    req = candidate_requests[node - N]
                    sh = req_shelters[node - N]
                    sh_lat = float(sh["lat"])
                    sh_lng = float(sh["lng"])
                    dropped_count = int(req["peopleCount"])

                    d_km, dur_min = get_travel_estimate(
                        curr_lat, curr_lng, sh_lat, sh_lng, spd
                    )
                    curr_dist += d_km
                    curr_min += dur_min
                    curr_lat = sh_lat
                    curr_lng = sh_lng

                    # If previous stop is already dropoff at the SAME shelter, merge
                    if (
                        stops
                        and stops[-1]["type"] == "DROPOFF"
                        and stops[-1]["targetId"] == sh["id"]
                    ):
                        stops[-1]["passengersDroppedOff"] += dropped_count
                    else:
                        stops.append({
                            "stopNumber": stop_counter,
                            "type": "DROPOFF",
                            "targetId": sh["id"],
                            "lat": sh["lat"],
                            "lng": sh["lng"],
                            "passengersPickedUp": 0,
                            "passengersDroppedOff": dropped_count,
                            "estimatedArrivalMinutes": round(curr_min, 2),
                        })
                        stop_counter += 1

            if stops:
                routes.append({
                    "resourceId": res["id"],
                    "stops": stops,
                    "totalTravelDistanceKm": round(curr_dist, 2),
                    "totalDurationMinutes": round(curr_min, 2),
                    "servedRequestIds": route_served,
                })

    # Classify unserved candidate requests with verified evidence (Task 4)
    solver_status = routing.status()
    timed_out = solver_status == pywrapcp.RoutingModel.ROUTING_FAIL_TIMEOUT

    for req in candidate_requests:
        if req["id"] not in served_ids:
            # Check if direct mission (start -> req -> nearest shelter) strictly exceeds max_shift_minutes
            min_direct_duration = min(
                (
                    get_travel_estimate(
                        float(r["lat"]),
                        float(r["lng"]),
                        float(req["lat"]),
                        float(req["lng"]),
                        float(r.get("speedKmH", 30.0)),
                    )[1]
                    + min(
                        get_travel_estimate(
                            float(req["lat"]),
                            float(req["lng"]),
                            float(sh["lat"]),
                            float(sh["lng"]),
                            float(r.get("speedKmH", 30.0)),
                        )[1]
                        for sh in shelters
                    )
                )
                for r in available_resources
            )

            if min_direct_duration > max_shift_minutes:
                unserved_list.append({
                    "requestId": req["id"],
                    "reason": "SHIFT_LIMIT_REACHED",
                    "details": (
                        f"Request requires at least {min_direct_duration:.1f} minutes for direct mission, "
                        f"which exceeds the vehicle shift limit ({max_shift_minutes:.1f} min)"
                    ),
                })
            else:
                timeout_note = " (solver reached search time limit)" if timed_out else ""
                unserved_list.append({
                    "requestId": req["id"],
                    "reason": "CAPACITY_EXCEEDED",
                    "details": (
                        f"Request of {req['peopleCount']} passengers could not be assigned within "
                        f"vehicle capacity, shift duration, or search limits{timeout_note}"
                    ),
                })

    duration_ms = int((time.perf_counter() - start_time) * 1000)
    metrics = calculate_metrics(scenario, routes, unserved_list, duration_ms)

    return {
        "scenarioId": scenario_id,
        "calculatedAt": datetime.now(timezone.utc).isoformat(),
        "routes": routes,
        "unserved": unserved_list,
        "metrics": metrics,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="FloodRelay Google OR-Tools Baseline Solver"
    )
    parser.add_argument(
        "--scenario",
        type=str,
        help="Path to scenario JSON file (defaults to stdin)",
    )
    parser.add_argument(
        "--output",
        type=str,
        help="Path to output JSON file (defaults to stdout)",
    )
    parser.add_argument(
        "--max-shift",
        type=float,
        default=480.0,
        help="Maximum shift duration in minutes (default 480.0)",
    )
    parser.add_argument(
        "--time-limit",
        type=float,
        default=5.0,
        help="Solver execution time limit in seconds (default 5.0)",
    )

    args = parser.parse_args()

    try:
        if args.scenario:
            with open(args.scenario, "r", encoding="utf-8") as f:
                scenario_data = json.load(f)
        else:
            scenario_data = json.load(sys.stdin)
    except Exception as e:
        sys.stderr.write(f"Error reading scenario input: {e}\n")
        sys.exit(1)

    try:
        plan = solve(
            scenario_data,
            max_shift_minutes=args.max_shift,
            time_limit_seconds=args.time_limit,
        )
        output_str = json.dumps(plan, indent=2)
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(output_str)
        else:
            sys.stdout.write(output_str + "\n")
    except Exception as e:
        sys.stderr.write(f"Error during OR-Tools solve: {e}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
