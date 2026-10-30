# FloodRelay Google OR-Tools Optimization Baseline

This directory contains the Google OR-Tools Python baseline solver for FloodRelay.

## Overview

The solver formulates flood rescue resource dispatch as a **Pickup and Delivery Problem (PDP)** with:

- **Heterogeneous Vehicle Routing:** Supports diverse rescue resources (boats, high-water trucks) with individual speeds and passenger capacities.
- **Capacity Dimensions:** Strict passenger capacity limits enforced continuously along each route. Multi-trip routing allows vehicles to offload evacuees at designated safe shelters and continue rescues.
- **Shift Limits and Return Legs:** Vehicle time dimension strictly bounds total mission duration (default 480 minutes / 8 hours), requiring all vehicles to conclude at a safe shelter drop-off before shift completion.
- **Urgency Prioritization:** Disjunction penalty scaling (`CRITICAL` > `HIGH` > `MEDIUM` > `LOW`) and soft cumulative arrival bounds prioritize life-critical rescues.
- **Distinct Unserved Reasons:** Categorizes unserved requests distinguishing proven infeasibility (`GROUP_LARGER_THAN_ANY_VEHICLE`, `SHIFT_LIMIT_REACHED`, `NO_REACHABLE_RESOURCE`, `CAPACITY_EXCEEDED`) from requests omitted by routing search or time limit decisions (`UNASSIGNED`).
- **Algorithmic Nature & Optimality:** The solver uses constraint programming and guided local search metaheuristics to find high-quality feasible solutions within configurable time limits. On NP-hard vehicle routing problems, it does not guarantee or prove global optimality under practical search limits.

## Installation

### Prerequisites

- Python 3.10+ (Python 3.12 recommended)
- `pip`

### Virtual Environment Setup

**On Windows:**

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
```

**On Linux / macOS:**

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Running the Solver

### CLI (stdin / stdout)

The solver accepts scenario JSON via stdin and prints the `SolverPlan` JSON to stdout:

```bash
python -m tools.ortools-baseline.solver < scenario.json > plan.json
```

### CLI Arguments

- `--scenario <path>`: Path to input scenario JSON (defaults to stdin).
- `--output <path>`: Path to write result JSON (defaults to stdout).
- `--max-shift <minutes>`: Maximum vehicle shift duration in minutes (default: `480.0`).
- `--time-limit <seconds>`: Optimization search timeout in seconds (default: `5.0`).

Example:

```bash
python -m tools.ortools-baseline.solver --scenario sample.json --time-limit 2.0 --max-shift 360
```

## Running Tests

From the repository root or this directory:

```bash
pytest tools/ortools-baseline/tests
```
