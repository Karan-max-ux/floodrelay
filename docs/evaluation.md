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

To evaluate algorithmic stability under dynamic or uncertain flood conditions, FloodRelay tests solvers against perturbed environments using `scenarios/perturb.ts` (`runPerturbationStudy`).

### Perturbation Methodology

1. **Travel Time Noise:** Travel times between every pair of locations are scaled by multiplicative lognormal noise (1 + δ), where δ has zero mean on the log scale and standard deviation proportional to the perturbation magnitude (0%, 10%, 25%, 50%).
2. **Timestamp Jitter:** Request intake timestamps are jittered uniformly by ±magnitude × 15 minutes to simulate reporting jitter and out-of-order intake.
3. **Plan Churn Metrics:**
   - **Assignment Churn (%):** Percentage of requests assigned to a different vehicle resource (or left unserved) compared to the unperturbed baseline plan.
   - **Route Churn (%):** Percentage of vehicle routes whose multiset of served requests differs from the baseline route.
   - **Sequence Churn (%):** Normalized Levenshtein edit distance between the sequence of served request IDs in the perturbed route versus the baseline route, averaged across all routes.
   - **Coverage Delta:** Change in the total number of served requests under perturbation.

### Perturbation Study Results

Empirical results from running `npx tsx scenarios/perturb.ts scenarios/sample-scenario.json` across perturbation magnitudes with random seeds [42, 1337, 2026]:

| Scenario                   | Solver                        |  Magnitude   | Assignment Churn (%) | Route Churn (%) | Sequence Churn (%) | Coverage Delta |
| :------------------------- | :---------------------------- | :----------: | :------------------: | :-------------: | :----------------: | :------------: |
| scenario-delhi-yamuna-demo | Nearest-First (Greedy)        | 0% (Control) |         0.0%         |      0.0%       |        0.0%        |       +0       |
| scenario-delhi-yamuna-demo | Nearest-First (Greedy)        |     10%      |         0.0%         |      0.0%       |        0.0%        |       +0       |
| scenario-delhi-yamuna-demo | Nearest-First (Greedy)        |     25%      |         0.0%         |      0.0%       |        0.0%        |       +0       |
| scenario-delhi-yamuna-demo | Nearest-First (Greedy)        |     50%      |         0.0%         |      66.7%      |       46.7%        |       +0       |
| scenario-delhi-yamuna-demo | Cluster-Allocation            | 0% (Control) |         0.0%         |      0.0%       |        0.0%        |       +0       |
| scenario-delhi-yamuna-demo | Cluster-Allocation            |     10%      |         0.0%         |      0.0%       |        0.0%        |       +0       |
| scenario-delhi-yamuna-demo | Cluster-Allocation            |     25%      |         0.0%         |      0.0%       |        0.0%        |       +0       |
| scenario-delhi-yamuna-demo | Cluster-Allocation            |     50%      |         0.0%         |      0.0%       |        0.0%        |       +0       |
| scenario-delhi-yamuna-demo | Clarke-Wright Savings + 2-opt | 0% (Control) |         0.0%         |      0.0%       |        0.0%        |       +0       |
| scenario-delhi-yamuna-demo | Clarke-Wright Savings + 2-opt |     10%      |         0.0%         |      66.7%      |       40.0%        |       +0       |
| scenario-delhi-yamuna-demo | Clarke-Wright Savings + 2-opt |     25%      |         0.0%         |      66.7%      |       46.7%        |       +0       |
| scenario-delhi-yamuna-demo | Clarke-Wright Savings + 2-opt |     50%      |         0.0%         |      66.7%      |       53.3%        |       +0       |

### Key Observations & Findings

1. **Cluster-Allocation Stability:** In the evaluated scenario, Cluster-Allocation exhibited 0.0% assignment churn, 0.0% route churn, and 0.0% sequence churn across all perturbation magnitudes (0% to 50%). Because DBSCAN groups requests into spatial partitions before vehicle allocation, small-to-moderate travel time variations do not alter the underlying geometric cluster memberships or the rank order of composite cluster urgencies.
2. **Nearest-First Sensitivity at High Perturbation:** Nearest-First remains stable under mild perturbations (0% churn at 10% and 25%), but undergoes route reshuffling at 50% perturbation (66.7% route churn, 46.7% sequence churn). At high travel-time noise, the greedy selection of closest pending stop flips between nearby candidates, altering downstream dispatch order.
3. **Clarke-Wright Savings Vulnerability to Perturbations:** Clarke-Wright Savings + 2-opt showed high sensitivity to perturbation even at 10% magnitude (66.7% route churn, 40.0% sequence churn). Because savings values s(i, j) = d(i, shelter) + d(shelter, j) - d(i, j) depend directly on edge cost differentials, travel time noise alters the sorting order of savings pairs, causing different route merges and 2-opt orderings.
4. **Google OR-Tools Exclusion:** Google OR-Tools operates in an external Python child process (`tools/ortools-baseline/solver.py`) using its own internal Euclidean distance computations and cannot accept custom TypeScript `TravelTimeProvider` implementations. As a result, OR-Tools is excluded from the automated TypeScript perturbation study harness.
