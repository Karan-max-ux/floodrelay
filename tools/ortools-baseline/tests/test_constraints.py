"""Invariant and constraint verification tests for OR-Tools baseline."""

from pathlib import Path
import sys
from typing import Any

# Ensure tools/ortools-baseline is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from solver import solve
from model import get_travel_estimate


def test_capacity_never_exceeded():
    scenario: dict[str, Any] = {
        "id": "capacity-test-scenario",
        "requests": [
            {"id": f"req-{i}", "lat": 28.5 + (i * 0.01), "lng": 77.1 + (i * 0.01), "peopleCount": (i % 4) + 2, "urgency": "HIGH"}
            for i in range(12)
        ],
        "resources": [
            {"id": "res-1", "capacity": 8, "speedKmH": 25, "lat": 28.5, "lng": 77.1, "status": "AVAILABLE"},
            {"id": "res-2", "capacity": 10, "speedKmH": 30, "lat": 28.52, "lng": 77.12, "status": "AVAILABLE"},
        ],
        "shelters": [
            {"id": "shelter-1", "lat": 28.51, "lng": 77.11, "capacity": 100},
            {"id": "shelter-2", "lat": 28.58, "lng": 77.18, "capacity": 100},
        ],
    }

    plan = solve(scenario, max_shift_minutes=480.0, time_limit_seconds=3.0)

    res_caps = {r["id"]: r["capacity"] for r in scenario["resources"]}

    for route in plan["routes"]:
        cap = res_caps[route["resourceId"]]
        load = 0
        for stop in route["stops"]:
            if stop["type"] == "PICKUP":
                load += stop["passengersPickedUp"]
                assert load <= cap, f"Vehicle load {load} exceeded capacity {cap}"
                assert load >= 0
            elif stop["type"] == "DROPOFF":
                load -= stop["passengersDroppedOff"]
                assert load >= 0, f"Vehicle load became negative ({load})"
        assert load == 0, f"Vehicle ended route with unevacuated passengers ({load})"


def test_shift_limit_strictly_enforced():
    scenario: dict[str, Any] = {
        "id": "shift-test-scenario",
        "requests": [
            {"id": f"req-{i}", "lat": 28.5 + (i * 0.02), "lng": 77.1 + (i * 0.02), "peopleCount": 2, "urgency": "MEDIUM"}
            for i in range(10)
        ],
        "resources": [
            {"id": "res-1", "capacity": 12, "speedKmH": 25, "lat": 28.5, "lng": 77.1, "status": "AVAILABLE"}
        ],
        "shelters": [
            {"id": "shelter-1", "lat": 28.5, "lng": 77.1, "capacity": 100}
        ],
    }

    for shift_limit in [30.0, 60.0, 120.0]:
        plan = solve(scenario, max_shift_minutes=shift_limit, time_limit_seconds=2.0)
        for route in plan["routes"]:
            assert (
                route["totalDurationMinutes"] <= shift_limit + 1e-2
            ), f"Route duration {route['totalDurationMinutes']} exceeded shift limit {shift_limit}"


def test_return_leg_to_shelter_enforced():
    """Regression test: verifies that a pickup cannot be performed if the return trip to shelter overruns shift limit."""
    # Vehicle starts at (28.5, 77.1), speed 30 km/h.
    # Shelter is colocated at (28.5, 77.1).
    # Request is ~10 km north at (28.59, 77.1).
    # One-way travel estimate:
    _, one_way_dur = get_travel_estimate(28.5, 77.1, 28.59, 77.1, 30.0)
    round_trip_dur = one_way_dur * 2

    # If shift limit is enough for one-way (e.g. one_way_dur + 5 min), but NOT enough for round trip:
    shift_limit = one_way_dur + (one_way_dur * 0.5)
    assert shift_limit < round_trip_dur

    scenario: dict[str, Any] = {
        "id": "return-leg-regression",
        "requests": [
            {"id": "req-far", "lat": 28.59, "lng": 77.1, "peopleCount": 2, "urgency": "HIGH"}
        ],
        "resources": [
            {"id": "res-1", "capacity": 10, "speedKmH": 30, "lat": 28.5, "lng": 77.1, "status": "AVAILABLE"}
        ],
        "shelters": [
            {"id": "shelter-1", "lat": 28.5, "lng": 77.1, "capacity": 100}
        ],
    }

    plan = solve(scenario, max_shift_minutes=shift_limit, time_limit_seconds=2.0)

    # Request MUST NOT be served because vehicle cannot return to shelter within shift limit
    assert plan["routes"] == []
    assert len(plan["unserved"]) == 1
    assert plan["unserved"][0]["requestId"] == "req-far"
    assert plan["unserved"][0]["reason"] == "SHIFT_LIMIT_REACHED"


def test_no_duplicate_assignments():
    scenario: dict[str, Any] = {
        "id": "duplicate-test-scenario",
        "requests": [
            {"id": f"req-{i}", "lat": 28.5 + (i * 0.01), "lng": 77.1 + (i * 0.01), "peopleCount": 2, "urgency": "HIGH"}
            for i in range(8)
        ],
        "resources": [
            {"id": "res-1", "capacity": 6, "speedKmH": 30, "lat": 28.5, "lng": 77.1, "status": "AVAILABLE"},
            {"id": "res-2", "capacity": 6, "speedKmH": 30, "lat": 28.51, "lng": 77.11, "status": "AVAILABLE"},
        ],
        "shelters": [
            {"id": "shelter-1", "lat": 28.5, "lng": 77.1, "capacity": 100}
        ],
    }

    plan = solve(scenario, max_shift_minutes=480.0, time_limit_seconds=3.0)

    all_served = [sid for r in plan["routes"] for sid in r["servedRequestIds"]]
    assert len(all_served) == len(set(all_served)), "A request was served more than once!"

    pickup_stops = [s["targetId"] for r in plan["routes"] for s in r["stops"] if s["type"] == "PICKUP"]
    assert len(pickup_stops) == len(set(pickup_stops)), "A pickup stop was visited more than once!"


def test_unavailable_resources_assigned_nothing():
    scenario: dict[str, Any] = {
        "id": "unavailable-resources-test",
        "requests": [
            {"id": "req-1", "lat": 28.52, "lng": 77.12, "peopleCount": 2, "urgency": "HIGH"}
        ],
        "resources": [
            {"id": "res-offline", "capacity": 10, "speedKmH": 30, "lat": 28.5, "lng": 77.1, "status": "OFFLINE"},
            {"id": "res-maint", "capacity": 10, "speedKmH": 30, "lat": 28.5, "lng": 77.1, "status": "MAINTENANCE"},
        ],
        "shelters": [
            {"id": "shelter-1", "lat": 28.5, "lng": 77.1, "capacity": 100}
        ],
    }

    plan = solve(scenario, max_shift_minutes=480.0, time_limit_seconds=2.0)
    assert plan["routes"] == []
    assert len(plan["unserved"]) == 1


def test_colocated_pickup_and_shelter_precedence():
    """Verifies that when a pickup is colocated with a shelter, pickup strictly precedes dropoff."""
    scenario: dict[str, Any] = {
        "id": "colocated-test",
        "requests": [
            # Exactly same coordinates as shelter
            {"id": "req-colocated", "lat": 28.5, "lng": 77.1, "peopleCount": 2, "urgency": "HIGH"}
        ],
        "resources": [
            {"id": "res-1", "capacity": 6, "speedKmH": 30, "lat": 28.52, "lng": 77.12, "status": "AVAILABLE"}
        ],
        "shelters": [
            {"id": "shelter-base", "lat": 28.5, "lng": 77.1, "capacity": 100}
        ],
    }

    plan = solve(scenario, max_shift_minutes=480.0, time_limit_seconds=2.0)
    assert len(plan["routes"]) == 1
    route = plan["routes"][0]
    assert len(route["stops"]) == 2

    # Stop 1 must be PICKUP, Stop 2 must be DROPOFF
    assert route["stops"][0]["type"] == "PICKUP"
    assert route["stops"][0]["targetId"] == "req-colocated"
    assert route["stops"][1]["type"] == "DROPOFF"
    assert route["stops"][1]["targetId"] == "shelter-base"

    # Precedence: arrival at dropoff must be >= arrival at pickup
    arr_pickup = route["stops"][0]["estimatedArrivalMinutes"]
    arr_dropoff = route["stops"][1]["estimatedArrivalMinutes"]
    assert arr_dropoff >= arr_pickup


def test_every_active_route_ends_at_shelter():
    """Verifies that all active routes conclude at a shelter."""
    scenario: dict[str, Any] = {
        "id": "multi-route-shelter-end",
        "requests": [
            {"id": f"req-{i}", "lat": 28.51 + (i * 0.01), "lng": 77.11, "peopleCount": 2, "urgency": "HIGH"}
            for i in range(4)
        ],
        "resources": [
            {"id": "res-1", "capacity": 6, "speedKmH": 30, "lat": 28.5, "lng": 77.1, "status": "AVAILABLE"},
            {"id": "res-2", "capacity": 6, "speedKmH": 30, "lat": 28.55, "lng": 77.15, "status": "AVAILABLE"},
        ],
        "shelters": [
            {"id": "shelter-1", "lat": 28.5, "lng": 77.1, "capacity": 100},
            {"id": "shelter-2", "lat": 28.56, "lng": 77.16, "capacity": 100},
        ],
    }

    plan = solve(scenario, max_shift_minutes=480.0, time_limit_seconds=3.0)
    assert len(plan["routes"]) > 0
    shelter_ids = {s["id"] for s in scenario["shelters"]}

    for route in plan["routes"]:
        last_stop = route["stops"][-1]
        assert last_stop["type"] == "DROPOFF"
        assert last_stop["targetId"] in shelter_ids
        assert last_stop["estimatedArrivalMinutes"] <= route["totalDurationMinutes"] + 0.05

