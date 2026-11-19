# FloodRelay — Background Queue Evaluation & Redis/BullMQ Analysis (Phase 6)

## 1. Executive Summary & Architectural Verdict

As part of **Phase 6 Task 3**, FloodRelay evaluated whether introducing an asynchronous distributed queue (such as **Redis + BullMQ**) is technically justified for the platform's incremental solver repair and operational event pipeline.

### Architectural Verdict

> [!IMPORTANT]
> **VERDICT: DEFERRED.**  
> The decision to defer Redis/BullMQ is based on the ultra-low algorithmic execution latency (< 3 ms) of the in-process incremental repair solver and the prioritization of single-database PostgreSQL ACID transaction atomicity (preventing life-critical dual-write loss during disaster response). It is an intentional engineering trade-off for current operational scales, not a claim that asynchronous queueing has zero architectural value in general.

---

## 2. Empirical Benchmark Evidence: In-Process Algorithmic Solver Repair

The evaluation harness in [`tools/benchmarkQueueNeed.ts`](file:///c:/Users/amans/OneDrive/Desktop/flood/tools/benchmarkQueueNeed.ts) executed deterministic local repair benchmarks across three standard disaster operational scales on Node.js 24 LTS.

> [!NOTE]
> **Measurement Boundary:** This micro-benchmark isolates the **in-memory algorithmic repair calculation** and event loop impact of the pure TypeScript incremental solver. External database persistence, HTTP lifecycle serialization, and external OSRM road graph calls are measured separately in the Grafana k6 load test suite.

### A. Solver Execution Latency

| Scenario Scale                 | Requests | Fleet Craft | Shelters | Iterations | p50 Latency | p90 Latency | p95 Latency | Max Latency |
| :----------------------------- | :------: | :---------: | :------: | :--------: | :---------: | :---------: | :---------: | :---------: |
| **Small (Emergency Cohort)**   |    20    |      4      |    2     |     50     | **0.14 ms** |   0.21 ms   |   0.23 ms   |   0.74 ms   |
| **Medium (Basin Sector)**      |   100    |     15      |    5     |     50     | **0.54 ms** |   0.87 ms   |   1.04 ms   |   2.68 ms   |
| **Large (District Catchment)** |   500    |     40      |    10    |     30     | **0.25 ms** |   0.31 ms   |   0.38 ms   |   0.70 ms   |

### B. Node.js Event-Loop Delay Profiling

Using Node.js native `perf_hooks.monitorEventLoopDelay({ resolution: 5 })` during continuous back-to-back solver repairs:

- **Min Delay:** 4.96 ms
- **Mean Delay:** 15.83 ms
- **p50 (Median) Delay:** **15.52 ms**
- **p90 Delay:** 16.11 ms
- **p99 Delay:** **20.97 ms**
- **Max Delay:** 68.09 ms (during initial module JIT warm-up)
- **Acceptance Threshold:** < 50.0 ms (Human imperceptible)

### C. Memory Footprint

- **Initial Heap Allocation:** 11.57 MB
- **Peak Heap Allocation:** 13.85 MB
- **Net Heap Delta:** **+2.28 MB** (Negligible GC pressure)

### D. Unmeasured Operational Dimensions (Explicit Scope Boundary)

To maintain rigorous experimental integrity, the following dimensions are labeled:

- **Worker Process Queuing:** `NOT MEASURED` in micro-benchmark (the system uses an in-process synchronous model).
- **Distributed Message Broker Serialization:** `NOT MEASURED` (no inter-process Redis publisher).
- **OSRM External Road Graph Query Latency:** Evaluated separately via [`packages/solver/src/evaluation/benchmark.ts`](file:///c:/Users/amans/OneDrive/Desktop/flood/packages/solver/src/evaluation/benchmark.ts).

---

## 3. End-to-End HTTP Load Test Results (Grafana k6)

Under Baseline Profile B load testing (30 concurrent Virtual Users executing blended citizen intakes, operator polling, and transactional repair proposals over 1 minute):

- **Total Requests Completed:** 4,266 requests
- **Sustained Throughput:** 69.56 requests / second
- **HTTP Failure Rate:** **0.00%** (0 errors out of 4,266)
- **p50 Latency:** **11.28 ms**
- **p95 Latency:** **82.58 ms**
- **Frozen Stop Violations:** **0**

---

## 4. Technical Trade-off Analysis: Redis/BullMQ vs. PostgreSQL Outbox

| Evaluation Dimension       | PostgreSQL Transactional Outbox (Current)                                                                                                      | Redis + BullMQ Queue (Proposed)                                                                                                  | Assessment                                                                                       |
| :------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------- |
| **ACID Atomicity**         | **Guaranteed.** Operational events, resource status updates, and audit logs commit in the same atomic database transaction (`BEGIN...COMMIT`). | **Dual-Write Vulnerability.** Database commit can succeed while Redis message publish fails or is lost during network partition. | **PostgreSQL Wins.** In emergency disaster response, dropping an event risks abandoning victims. |
| **Operational Simplicity** | **Single Datastore.** PostGIS handles spatial queries, relational schemas, and operational outbox. Zero extra containers.                      | **Additional Daemon.** Requires running, monitoring, securing, and backing up a separate Redis instance.                         | **PostgreSQL Wins.** Field disaster deployments benefit from minimal moving parts.               |
| **Operator Workflow**      | **Synchronous Feedback.** Dispatcher requests repair and immediately receives proposed route diff within ~12 ms.                               | **Asynchronous Polling.** Requires job IDs, polling loops or WebSockets, and state synchronization.                              | **PostgreSQL Wins.** A 1 ms solver computation does not warrant asynchronous polling.            |
| **Worker Decoupling**      | **In-process.** Runs on API event loop (acceptable given < 3 ms solver execution).                                                             | **Dedicated Workers.** Decouples CPU-heavy calculations into separate processes or containers.                                   | **Redis Advantage.** Valuable if solver runtime exceeds 500 ms (e.g. global MILP optimization).  |

---

## 5. Architectural Decision & Future Thresholds

As recorded in **ADR-42** (`docs/decisions.md`), the project team formally defers Redis and BullMQ.

### Re-evaluation Triggers

Redis/BullMQ or Node.js Worker Threads will be reconsidered if future operational requirements demonstrate:

1. Incident volumes exceeding **5,000 concurrent rescue requests** per sector.
2. Solver execution p95 latency exceeding **500 ms** (e.g., transition to large-scale mixed integer programming or multi-basin global replanning).
3. Event-loop lag exceeding **100 ms** under continuous background optimization.
