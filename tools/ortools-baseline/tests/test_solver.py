"""Unit and functional tests for the OR-Tools baseline solver."""

import json
from pathlib import Path
import subprocess
import sys
from typing import Any

import pytest

# Ensure tools/ortools-baseline is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from solver import solve



@pytest.fixture
def base_scenario() -> dict[str, Any]:
    return {
        "id": "test-scenario",
        "metadata": {
            "id": "test-scenario",
            "name": "Test Scenario",
            "region": "Delhi",
            "createdAt": "2026-10-15T12:00:00Z",
            "bounds": {"minLat": 28.5, "maxLat": 28.7, "minLng": 77.1, "maxLng": 77.3},
        },
        "requests": [
            {
                "id": "req-1",
                "lat": 28.52,
                "lng": 77.12,
                "peopleCount": 3,
                "urgency": "HIGH",
                "createdAt": "2026-10-15T12:00:00Z",
                "source": "SIMULATED",
            },
            {
                "id": "req-2",
                "lat": 28.53,
                "lng": 77.13,
                "peopleCount": 4,
                "urgency": "CRITICAL",
                "createdAt": "2026-10-15T12:00:00Z",
                "source": "SIMULATED",
            },
            {
                "id": "req-3",
                "lat": 28.55,
                "lng": 77.15,
                "peopleCount": 5,
                "urgency": "LOW",
                "createdAt": "2026-10-15T12:00:00Z",
                "source": "SIMULATED",
            },
        ],
        "resources": [
            {
                "id": "res-boat-1",
                "name": "Boat Alpha",
                "type": "BOAT",
                "capacity": 8,
                "speedKmH": 25,
                "lat": 28.5,
                "lng": 77.1,
                "status": "AVAILABLE",
            }
        ],
        "shelters": [
            {
                "id": "shelter-1",
                "name": "Relief Camp",
                "lat": 28.51,
                "lng": 77.11,
                "capacity": 50,
            }
        ],
    }


def test_solve_basic_scenario(base_scenario: dict[str, Any]):
    plan = solve(base_scenario, max_shift_minutes=480.0, time_limit_seconds=3.0)

    assert plan["scenarioId"] == "test-scenario"
    assert len(plan["routes"]) == 1
    assert plan["unserved"] == []
    assert plan["metrics"]["coveragePercent"] == 100.0
    assert plan["metrics"]["servedRequestsCount"] == 3
    assert plan["metrics"]["unservedRequestsCount"] == 0

    route = plan["routes"][0]
    assert route["resourceId"] == "res-boat-1"
    assert set(route["servedRequestIds"]) == {"req-1", "req-2", "req-3"}
    assert route["totalDurationMinutes"] > 0
    assert route["totalTravelDistanceKm"] > 0

    # Ensure stops alternate and capacity is never exceeded
    load = 0
    for stop in route["stops"]:
        if stop["type"] == "PICKUP":
            load += stop["passengersPickedUp"]
            assert load <= 8
        elif stop["type"] == "DROPOFF":
            load -= stop["passengersDroppedOff"]
            assert load == 0
    assert load == 0


def test_solve_empty_scenario(base_scenario: dict[str, Any]):
    scenario = dict(base_scenario)
    scenario["requests"] = []

    plan = solve(scenario)
    assert plan["routes"] == []
    assert plan["unserved"] == []
    assert plan["metrics"]["coveragePercent"] == 100.0
    assert plan["metrics"]["totalRequestsCount"] == 0


def test_solve_no_available_resources(base_scenario: dict[str, Any]):
    scenario = dict(base_scenario)
    scenario["resources"] = [
        dict(scenario["resources"][0], status="OFFLINE")
    ]

    plan = solve(scenario)
    assert plan["routes"] == []
    assert len(plan["unserved"]) == 3
    for u in plan["unserved"]:
        assert u["reason"] == "CAPACITY_EXCEEDED"
    assert plan["metrics"]["coveragePercent"] == 0.0


def test_solve_no_shelters(base_scenario: dict[str, Any]):
    scenario = dict(base_scenario)
    scenario["shelters"] = []

    plan = solve(scenario)
    assert plan["routes"] == []
    assert len(plan["unserved"]) == 3
    for u in plan["unserved"]:
        assert u["reason"] == "NO_REACHABLE_RESOURCE"
    assert plan["metrics"]["coveragePercent"] == 0.0


def test_solve_group_larger_than_any_vehicle(base_scenario: dict[str, Any]):
    scenario = dict(base_scenario)
    scenario["requests"] = [
        {
            "id": "req-oversized",
            "lat": 28.52,
            "lng": 77.12,
            "peopleCount": 15,  # Boat capacity is only 8
            "urgency": "CRITICAL",
            "createdAt": "2026-10-15T12:00:00Z",
            "source": "SIMULATED",
        }
    ]

    plan = solve(scenario)
    assert plan["routes"] == []
    assert len(plan["unserved"]) == 1
    assert plan["unserved"][0]["reason"] == "GROUP_LARGER_THAN_ANY_VEHICLE"
    assert "exceeds maximum vehicle capacity" in plan["unserved"][0]["details"]
    assert plan["metrics"]["coveragePercent"] == 0.0


def test_solve_urgency_prioritization(base_scenario: dict[str, Any]):
    # Limit shift to just 25 minutes so only one trip can be made
    plan = solve(base_scenario, max_shift_minutes=28.0, time_limit_seconds=3.0)

    # In this time window, CRITICAL req-2 or HIGH req-1 must be prioritized over LOW req-3
    served_ids = {
        sid for r in plan["routes"] for sid in r["servedRequestIds"]
    }
    assert "req-3" not in served_ids
    assert "req-2" in served_ids or "req-1" in served_ids

    # Unserved req-3 is classified with SHIFT_LIMIT_REACHED
    unserved_3 = next((u for u in plan["unserved"] if u["requestId"] == "req-3"), None)
    assert unserved_3 is not None
    assert unserved_3["reason"] == "SHIFT_LIMIT_REACHED"


def test_cli_invocation(base_scenario: dict[str, Any]):
    scenario_json = json.dumps(base_scenario)
    solver_script = str(Path(__file__).resolve().parent.parent / "solver.py")
    cmd = [
        sys.executable,
        solver_script,
        "--time-limit",
        "2.0",
        "--max-shift",
        "480",
    ]
    proc = subprocess.run(
        cmd,
        input=scenario_json,
        text=True,
        capture_output=True,
        check=True,
    )
    plan = json.loads(proc.stdout)
    assert plan["scenarioId"] == "test-scenario"
    assert plan["metrics"]["coveragePercent"] == 100.0

