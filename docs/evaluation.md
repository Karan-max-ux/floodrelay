# Solver Evaluation & Constraint Parity

This document details the operational and algorithmic constraints enforced across the allocation solvers in FloodRelay.

## Constraint Parity Matrix

| Constraint                     | Nearest-First (Greedy) | Urgency-batched savings + 2-opt | Cluster-Allocation | Google OR-Tools | Notes / Differences                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------ | :--------------------: | :-----------------------------: | :----------------: | :-------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capacity**                   |           ✅           |               ✅                |         ✅         |       ✅        | Never exceeds vehicle passenger capacity; drops off at shelter when full or when no further requests fit.                                                                                                                                                                                                                                             |
| **Availability**               |           ✅           |               ✅                |         ✅         |       ✅        | Only allocates resources with `AVAILABLE` or `ASSIGNED` status; `MAINTENANCE` or `OFFLINE` resources receive no routes.                                                                                                                                                                                                                               |
| **Shift limit**                |           ✅           |               ✅                |         ✅         |       ✅        | Enforces maximum operational duration (`maxShiftMinutes`, default 480 min per vehicle). Before any pickup is committed, the solver verifies that transit to the pickup plus the return leg to the nearest shelter does not exceed `maxShiftMinutes`. Note that `maxShiftMinutes` is a per-vehicle shift limit, not a combined fleet-wide time budget. |
| **Shelter drop-offs**          |           ✅           |               ✅                |         ✅         |       ✅        | Automatically routes vehicles to safe shelters to unload passengers whenever capacity requires or upon trip conclusion.                                                                                                                                                                                                                               |
| **Multiple trips per vehicle** |           ✅           |               ✅                |         ✅         |       ✅        | Vehicles execute multiple pickup-dropoff cycles from shelters as long as remaining shift duration permits.                                                                                                                                                                                                                                            |
| **Return to depot**            |      ✅ (Shelter)      |          ✅ (Shelter)           |    ✅ (Shelter)    |  ✅ (Shelter)   | In flood rescue operations, vehicles terminate trips at a designated safe shelter rather than deadheading back to initial spawn locations (ADR-11).                                                                                                                                                                                                   |
| **Frozen stops**               |           ❌           |               ❌                |         ✅         |       ❌        | Cluster-Allocation supports `existingFrozenRoutes` for interactive replanning without reshuffling operator-committed stops. The baseline solvers are static comparative benchmarks evaluated from an unassigned initial state and do not accept frozen route inputs.                                                                                  |

## Rationale for Differences

### Frozen Stops

In the FloodRelay architecture, operators review proposed routes and commit them. When new requests arrive or flood conditions change, the solver replans remaining demand while keeping committed stops fixed (frozen).

- **Cluster-Allocation** is designed as the production replanning heuristic and directly implements `existingFrozenRoutes` pre-seeding.
- **Nearest-First**, **Urgency-batched savings + 2-opt**, and **Google OR-Tools** serve as static algorithmic baselines used to benchmark dispatch quality, priority wait times, and travel efficiency on clean benchmark cases. They do not maintain dynamic replanning state. Note that the urgency-batched savings heuristic is a simplified urgency-partitioned variant and not a full textbook Clarke-Wright implementation.

## Competing Objectives and Metric Interpretation

In evaluating flood-rescue solvers on synthetic scenarios, lower total travel time does not automatically signify superior dispatch quality. Comparative performance observations reflect specific evaluated synthetic scenarios and parameter choices, rather than universal theoretical or field guarantees. Results vary with scenario scale and seed set, all scenarios are simulated with placeholder assumptions, and current numbers come from running `npx tsx scenarios/evaluate.ts`.

The solvers operate under competing operational objectives:

- **Travel efficiency:** Minimizing aggregate vehicle transit duration to conserve fuel and operational resources.
- **Triage responsiveness:** Minimizing wait times for critical and high-urgency rescue requests.
- **Demand coverage:** Maximizing the fraction of total requests served within per-vehicle shift duration limits (`maxShiftMinutes`, default 480 min per vehicle).

A naive greedy baseline such as Nearest-First is designed to form tight, hyper-local routes to achieve low total travel duration by serving proximate requests regardless of urgency, but in design risks leaving distant critical incidents waiting; these are intended design trade-offs rather than demonstrated results at every scenario scale. Conversely, solvers that prioritize urgency or spatial clusters intentionally route vehicles toward high-priority demands, which can increase overall travel duration.

### Algorithm Intent vs. Experimentally Demonstrated Results

It is critical to distinguish what each algorithm is intended to do from what benchmark experiments have demonstrated in evaluated test runs. Results vary with scenario scale and seed set, scenarios are simulated with placeholder assumptions, and the following observations reflect runs of `npx tsx scenarios/evaluate.ts` with default seeds rather than universal guarantees:

- **Nearest-First (Greedy):**
  - _Algorithm intent:_ Greedily minimize immediate travel time from the vehicle's current location to the closest pending request that fits remaining capacity.
  - _Findings in evaluated scenarios:_ In benchmark runs of `npx tsx scenarios/evaluate.ts` with default seeds, Nearest-First had the lowest total travel time in the Large suite only; this does not hold in the Small and Medium suites. It lacks triage prioritization for urgent requests.
- **Urgency-batched savings + 2-opt:**
  - _Algorithm intent:_ Batch candidate requests by urgency descending across the map and construct savings routes with 2-opt within each batch to serve urgent requests earlier.
  - _Implementation scope:_ This heuristic is not a full textbook Clarke-Wright implementation. It selects batches across the whole map based solely on urgency (ignoring geographic proximity during batch selection), evaluates savings only against a single primary shelter (`shelters[0]`), and runs 2-opt only within the batch.
  - _Findings in evaluated scenarios:_ In benchmark runs of `npx tsx scenarios/evaluate.ts` with default seeds, its behavior depends on scale:
    - In the Small suite, it had lower high-priority wait times and lower total travel time than Nearest-First.
    - In the Medium suite, its high-priority wait time was about the same as Nearest-First and its total travel time was slightly lower.
    - In the Large suite, its high-priority wait time was about the same as Nearest-First, its total travel time was much higher, and it left some low-urgency requests unserved under per-vehicle shift limits (`maxShiftMinutes`, default 480 min per vehicle).
    - The cause of this change in behavior with scale has not been investigated.
- **Cluster-Allocation:**
  - _Algorithm intent:_ Balance spatial compactness with triage priority by partitioning requests with DBSCAN clustering, ordering clusters by composite urgency, and allocating the nearest capable vehicles.
  - _Findings in evaluated scenarios:_ In benchmark runs of `npx tsx scenarios/evaluate.ts` with default seeds, Cluster-Allocation had the lowest high-priority wait time at every evaluated size (Small, Medium, and Large) and maintained full coverage at every size. Its total travel time was higher than Nearest-First in the Medium and Large suites. These observations reflect empirical behavior on the generated synthetic distributions and do not constitute universal guarantees for all arbitrary flood geographies, road topologies, or incident patterns.
- **Google OR-Tools:**
  - _Algorithm intent:_ Formulate flood rescue allocation as a combinatorial multi-vehicle Pickup and Delivery Problem (PDP) with capacity dimensions, shift-duration limits enforcing the return leg to safe shelters, and prioritized disjunction penalties. It employs constraint programming and guided local search metaheuristics to find feasible, high-quality dispatch plans under configurable search time limits. Because multi-vehicle PDP is NP-hard, it is a metaheuristic baseline that does not prove global optimality on general instances under practical search timeouts; exact optimality verification (such as matching brute-force optimum travel time) is tested strictly on the tiny 5-request exhaustive sanity scenario.
  - _Findings in evaluated scenarios:_ In benchmark runs of `npx tsx scenarios/evaluate.ts`, Google OR-Tools produces feasible multi-trip routing plans that satisfy all vehicle capacity and return-leg shift limits, prioritizing critical and high-urgency incidents. As an optimization baseline executing branch-and-bound and local search metaheuristics via Python child process, its execution duration is bounded by the user-specified search time limit parameter rather than executing in sub-second heuristic time.

## Phase 4 — Perturbation Study & Plan Churn

To evaluate algorithmic stability under travel-time estimation uncertainty, FloodRelay benchmarks solvers against perturbed travel-time matrices using `scenarios/perturb.ts` (`runPerturbationStudy`).

### Perturbation Methodology

1. **Travel Time Noise:** Travel times between each pair of locations are scaled by a multiplicative factor drawn uniformly from [1 - m, 1 + m] for perturbation magnitude m in {0, 0.10, 0.25, 0.50}. Noise is independent per travel-time pair and deterministic per `(seed, from, to)` coordinate pair, generated via a 32-bit FNV-1a hash over the seed and coordinates.
2. **Timestamp Jitter:** While `perturbRequestTimestamps` is provided to jitter request timestamps by ±m × 15 minutes, no current solver reads `createdAt`, so timestamp jitter cannot change plans. All observed churn is driven entirely by travel time perturbations.
3. **Plan Churn Metrics:**
   - **Assignment Churn (%):** Percentage of requests assigned to a different vehicle resource (or left unserved) compared to the unperturbed baseline plan.
   - **Route Churn (%):** Percentage of vehicles whose ordered pickup list changed compared to the baseline plan.
   - **Sequence Churn (%):** Percentage of requests whose immediate predecessor on the same vehicle changed compared to the baseline plan.
   - **Coverage Delta:** Change in the total number of served requests under perturbation (perturbed served count minus baseline served count).

### Perturbation Study Results (Generated Scenarios)

> [!NOTE]
> **SIMULATED**: All perturbation results are synthetic simulations generated under placeholder assumptions. Results vary with scenario seeds and noise draws. To regenerate these numbers, run:
>
> ```bash
> npx tsx scenarios/perturb.ts
> ```

The primary evaluation runs across 20 distinct synthetic scenario seeds (seeds 2026–2045; 40 requests, 6 vehicles, 3 shelters) with 5 independent noise draws per seed (`seeds: [42, 1337, 2026, 7777, 9999]`), totaling 100 evaluation runs per cell:

| Solver                          |  Magnitude   | Assignment Churn (%) | Route Churn (%) | Sequence Churn (%) | Coverage Delta |
| :------------------------------ | :----------: | :------------------: | :-------------: | :----------------: | :------------: |
| Nearest-First (Greedy)          | 0% (Control) |         0.0%         |      0.0%       |        0.0%        |     +0.00      |
| Nearest-First (Greedy)          |     10%      |        13.9%         |      97.8%      |       63.8%        |     +0.00      |
| Nearest-First (Greedy)          |     25%      |        20.3%         |      99.7%      |       79.4%        |     +0.00      |
| Nearest-First (Greedy)          |     50%      |        25.9%         |     100.0%      |       87.9%        |     +0.00      |
| Cluster-Allocation              | 0% (Control) |         0.0%         |      0.0%       |        0.0%        |     +0.00      |
| Cluster-Allocation              |     10%      |        45.5%         |      86.0%      |       58.9%        |     +0.00      |
| Cluster-Allocation              |     25%      |        58.9%         |      97.7%      |       75.0%        |     +0.00      |
| Cluster-Allocation              |     50%      |        68.8%         |      98.7%      |       85.1%        |     +0.00      |
| Urgency-batched savings + 2-opt | 0% (Control) |         0.0%         |      0.0%       |        0.0%        |     +0.00      |
| Urgency-batched savings + 2-opt |     10%      |         3.8%         |      93.7%      |       52.2%        |     +0.00      |
| Urgency-batched savings + 2-opt |     25%      |         4.7%         |      98.0%      |       64.7%        |     +0.00      |
| Urgency-batched savings + 2-opt |     50%      |         9.4%         |      99.5%      |       72.9%        |     +0.00      |

### Smoke Test (5-Request Sample Scenario)

A 5-request run on `scenarios/sample-scenario.json` (`scenario-delhi-yamuna-demo`) serves solely as an automated smoke test to verify execution of the evaluation pipeline (`npx tsx scenarios/perturb.ts --smoke`). Because of its tiny scale (5 requests, 3 vehicles), it exhibits artificial step-function behaviors (such as Cluster-Allocation showing 0% churn) that do not reflect performance at realistic operational scale:

| Scenario                   | Solver                          |  Magnitude   | Assignment Churn (%) | Route Churn (%) | Sequence Churn (%) | Coverage Delta |
| :------------------------- | :------------------------------ | :----------: | :------------------: | :-------------: | :----------------: | :------------: |
| scenario-delhi-yamuna-demo | Nearest-First (Greedy)          | 0% (Control) |         0.0%         |      0.0%       |        0.0%        |       +0       |
| scenario-delhi-yamuna-demo | Nearest-First (Greedy)          |     10%      |         0.0%         |      0.0%       |        0.0%        |       +0       |
| scenario-delhi-yamuna-demo | Nearest-First (Greedy)          |     25%      |         0.0%         |      0.0%       |        0.0%        |       +0       |
| scenario-delhi-yamuna-demo | Nearest-First (Greedy)          |     50%      |         0.0%         |      66.7%      |       46.7%        |       +0       |
| scenario-delhi-yamuna-demo | Cluster-Allocation              | 0% (Control) |         0.0%         |      0.0%       |        0.0%        |       +0       |
| scenario-delhi-yamuna-demo | Cluster-Allocation              |     10%      |         0.0%         |      0.0%       |        0.0%        |       +0       |
| scenario-delhi-yamuna-demo | Cluster-Allocation              |     25%      |         0.0%         |      0.0%       |        0.0%        |       +0       |
| scenario-delhi-yamuna-demo | Cluster-Allocation              |     50%      |         0.0%         |      0.0%       |        0.0%        |       +0       |
| scenario-delhi-yamuna-demo | Urgency-batched savings + 2-opt | 0% (Control) |         0.0%         |      0.0%       |        0.0%        |       +0       |
| scenario-delhi-yamuna-demo | Urgency-batched savings + 2-opt |     10%      |         0.0%         |      66.7%      |       40.0%        |       +0       |
| scenario-delhi-yamuna-demo | Urgency-batched savings + 2-opt |     25%      |         0.0%         |      66.7%      |       46.7%        |       +0       |
| scenario-delhi-yamuna-demo | Urgency-batched savings + 2-opt |     50%      |         0.0%         |      66.7%      |       53.3%        |       +0       |

### Key Observations & Findings

1. **Assignment Churn Differences Across Solvers:**
   - **Urgency-batched savings + 2-opt** showed the lowest assignment churn across all evaluated noise levels (3.8% at 10% magnitude, 4.7% at 25%, and 9.4% at 50%), preserving which vehicle is assigned to each request in over 90% of cases.
   - **Nearest-First (Greedy)** exhibited moderate assignment churn (13.9% at 10% magnitude, 20.3% at 25%, and 25.9% at 50%).
   - **Cluster-Allocation** exhibited the highest assignment churn (45.5% at 10% magnitude, 58.9% at 25%, and 68.8% at 50%). While the 5-request smoke test showed 0% churn, on the 40-request scenarios travel-time noise frequently altered vehicle-to-cluster assignment pairings.
2. **High Route and Sequence Churn Across All Algorithms:**
   - Across all three solvers, route churn exceeded 86% even at 10% noise and approached 98%–100% at 50% noise, indicating that the ordered pickup list of a vehicle almost always altered under perturbation.
   - Sequence churn (changes in immediate pickup predecessor) rose steadily from 52%–64% at 10% noise to 72%–88% at 50% noise across all solvers.
   - Even when Urgency-batched savings + 2-opt preserved vehicle-level request assignments (low assignment churn), the sequence of pickups within those routes still shifted under travel-time perturbations.
3. **Coverage Invariance:**
   - Coverage Delta remained +0.00 across all solvers and all perturbation magnitudes on the 40-request benchmark suite, showing that in these specific 40-request scenarios with generous shift budgets (480 minutes), total served count did not change despite route and sequence reorderings (this indicates that total requests served did not change on these evaluated runs, rather than proving that shift limits can never be breached under noise).
4. **Google OR-Tools Exclusion:**
   - Google OR-Tools operates in an external Python child process (`tools/ortools-baseline/solver.py`) using its own internal distance calculations and cannot accept custom TypeScript `TravelTimeProvider` implementations. As a result, OR-Tools is excluded from the automated TypeScript perturbation study harness.

## Road Network & Travel Time Evaluation Realities

1. **500-Point Prefetch Limit & Large Scenario Fallback:**
   The travel time provider factory (`prepareTravelTimeProvider`) enforces a safety ceiling of 500 total coordinates (`maxTableCoordinates = 500`). In the Large benchmark suite (500 requests + 30 resources + shelters = 530+ points), the coordinate count exceeds this ceiling, causing the factory to log a warning and fall back entirely to `StraightLineTravelTimeProvider`.
2. **Road Snapping Artifacts for Off-Road Demands:**
   OSRM table lookups snap all coordinates to the nearest navigable road segment in the OpenStreetMap road graph. In flood inundation zones where victims are stranded in open water, agricultural fields, or rooftop elevations far from navigable streets, snapping to the nearest road produces misleading road travel times that do not account for off-road access or water navigation.
