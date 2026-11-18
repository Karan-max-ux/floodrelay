# Flood Rescue Resource Allocation Platform — Progress

**Last updated:** 2026-11-18

**Current focus:** Phase 6 Delivery Verified & Hardened ✅ — Full audit, regression testing, and final hardening complete. Demo workflow simulated scenario commitment vs PR #41 operational provenance rules resolved via Simulation Preview Mode; demo operator credential desynchronization on repeated setup fixed with idempotent DB/file sync and post-verification; hydrological forecast correctness and edge-case handling hardened with zero false-normal fallbacks; UI hook `useFloodForecast` race-condition and unmount guards added; comprehensive unit and integration suites expanded across all 8 demonstration stages; production dependency security audit clean (0 vulnerabilities).

Status legend: ⬜ not started · 🟡 in progress · ✅ done

---

## 1. What we are building

Citizens (or helpers) submit rescue requests with location, number of people and urgency. The system validates and de-duplicates requests, groups nearby demand into clusters, estimates travel costs using the road network, and proposes assignments of resources to requests under capacity and availability constraints. Operators see assignments, unserved requests and the reasons on a live map, and commit or change them. When a new request arrives or a resource changes status, only the affected assignments are recalculated instead of rebuilding everything.

---

## 2. University requirements

- Next.js and React.js are compulsory.
- All other technologies are the team's choice.
- The project will be evaluated by faculty and is also meant to be real-world usable and portfolio-grade.

---

## 3. Principles

- No machine learning unless a measured need appears. Reliable algorithms are preferred.
- Real geographic data (OpenStreetMap roads, real forecast layers). Simulated rescue requests are always labelled `SIMULATED` and generated from a seeded, reproducible script.
- Every number shown must be real API data with a source and timestamp, user input, or the output of a deterministic algorithm. Never LLM-generated.
- Honest uncertainty: show stale or low-accuracy locations, show travel times as ranges, mark road status as known blocked / known open / unknown.
- Build the working, testable allocation workflow first. Add infrastructure (queue, real-time, routing server) only when a measurement or a feature needs it.
- Decision support only: a human operator commits assignments.

---

## 4. Tech stack

| Layer                | Choice                                                             | Why                                                                                                                    | Status       |
| -------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------ |
| Frontend (mandatory) | Next.js (App Router) + React + TypeScript                          | Citizen request form, operator dashboard, field-team view                                                              | Planned      |
| Map                  | react-leaflet loaded with dynamic import and SSR disabled          | Leaflet needs the browser `window` object                                                                              | Planned      |
| Backend              | Separate Node.js service, Express + TypeScript (strict mode)       | Intake, assignment, auth, live updates                                                                                 | Planned      |
| Database             | PostgreSQL + PostGIS                                               | Spatial queries and a built-in DBSCAN to verify our own clustering                                                     | Planned      |
| Queue and pub/sub    | PostgreSQL ACID Outbox (Redis Deferred)                            | Evaluated & deferred via empirical benchmarks (< 2.7 ms repair, < 21 ms event-loop lag, zero dual-write risk) (ADR-42) | ✅ Evaluated |
| Routing              | OSRM in Docker                                                     | Travel-time matrix from OpenStreetMap data                                                                             | Planned      |
| Live updates         | Polling first, Socket.IO when the dashboard needs it               | —                                                                                                                      | Planned      |
| Deployment           | docker-compose for the backend stack, frontend on any Next.js host | —                                                                                                                      | Planned      |
| Testing and CI       | Jest/Supertest, k6 for load tests, GitHub Actions                  | —                                                                                                                      | Planned      |

---

## 5. Architecture

**Flow:**

```
Incoming rescue requests
  → Validation (timestamps, verification status, duplicate detection)
  → PostGIS storage + DBSCAN demand clustering
  → Travel-time provider (straight-line first, OSRM later) + allocation optimizer
  → Operator dashboard (assignments, unserved requests, reasons, status updates)
```

**Design notes:**

- The solver is a standalone library in `packages/solver` that takes a scenario and returns assignments, with no database, HTTP or UI dependency.
- Travel time sits behind a `TravelTimeProvider` interface (straight-line times a detour factor first, OSRM version later).
- DBSCAN noise points are treated as their own demand units and are never dropped.
- Coordinates are projected to a metric system before clustering so the distance parameter is in metres.
- Unverified requests are shown with a flag or lower weight, never silently discarded.
- The solver proposes; an operator commits. Committed or dispatched stops are frozen and not reshuffled by re-optimization.
- Next.js middleware only hides pages; real authorization is enforced in the backend.

---

## 6. Incremental update strategy

| Event                                  | Handling                                                    |
| -------------------------------------- | ----------------------------------------------------------- |
| New request                            | Insert into best route                                      |
| Resource goes offline                  | Unassign its pending stops and re-insert, then local repair |
| Request cancelled or duplicate         | Remove from route                                           |
| Road newly blocked                     | Re-cost and repair only affected routes                     |
| Periodic or drift-triggered background | Full re-optimization applied only to non-frozen stops       |

**Benchmark three strategies:**

1. Full re-solve on every event
2. Insertion plus periodic re-optimization
3. Event-triggered local repair

---

## 7. Evaluation plan

- **Metrics** (fixed before solver code is written):
  - Coverage (percent of requests served)
  - Total travel time
  - Wait time for high-priority requests
  - Solve time
  - Latency per event (p50 and p95)
  - Assignment churn (how many already-communicated assignments change per event)
- **Baselines:** Nearest-First (greedy), Urgency-batched savings + 2-opt, and Google OR-Tools (Pickup and Delivery Problem baseline).
- At least 20 random seeds per scenario size, report mean and spread.
- **Standard scenario sizes:**
  - Small: 20 requests / 4 resources / 2 shelters
  - Medium: 100 requests / 12 resources / 3 shelters
  - Large: 500 requests / 30 resources / 5 shelters
- Results table is generated by a committed script and run in CI.
- **All results currently:** TBD (to be measured).

---

## 8. Phases (ordered, not scheduled)

### Phase 0 — Project setup

| Task                                                          | Owner | Status |
| ------------------------------------------------------------- | ----- | ------ |
| Root README.md                                                | —     | ✅     |
| .gitignore                                                    | —     | ✅     |
| .env.example                                                  | —     | ✅     |
| docs/decisions.md                                             | —     | ✅     |
| Conventions (branch naming, commits, PR process)              | —     | ✅     |
| GitHub branch protection rule on main                         | —     | ✅     |
| Folder structure                                              | —     | ✅     |
| Workspace tooling (root package.json, tsconfig, lint configs) | —     | ✅     |
| docker-compose for Postgres/PostGIS                           | —     | ✅     |
| CI skeleton                                                   | —     | ✅     |
| Agree on backend framework                                    | —     | ✅     |

### Phase 1 — Solver core and evaluation harness

| Task                                                                              | Owner | Status | Proving test(s)                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------- | ----- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scenario format                                                                   | —     | ✅     | `packages/shared/src/scenario.test.ts` (`validates valid scenario correctly`, `rejects invalid coordinates`)                                                                                                                                                                                                                                         |
| Seeded generator                                                                  | —     | ✅     | `packages/solver/src/generator.test.ts` (`same seed gives an identical scenario`, `different seeds give different scenarios`, `labels every single generated request as SIMULATED`)                                                                                                                                                                  |
| Metrics                                                                           | —     | ✅     | `packages/solver/src/metrics.test.ts` (`computes 50% coverage when 2 out of 4 requests are served`, `detects churn and frozen violations`)                                                                                                                                                                                                           |
| Nearest-first baseline                                                            | —     | ✅     | `packages/solver/src/baselines/nearestFirst.test.ts` (`capacity is never exceeded`, `no request is assigned twice`, `unavailable resources get nothing`)                                                                                                                                                                                             |
| Own DBSCAN                                                                        | —     | ✅     | `packages/solver/src/clustering/dbscan.test.ts` (`correctly partitions two distinct spatial clusters`, `DBSCAN keeps noise points as singleton demands`)                                                                                                                                                                                             |
| First allocation heuristic with straight-line distances behind TravelTimeProvider | —     | ✅     | `packages/solver/src/heuristics/clusterAllocation.test.ts` (`allocates resources to clusters and prioritizes critical urgency requests`, `frozen stops are not moved by replanning`, `capacity is never exceeded`)                                                                                                                                   |
| OR-Tools baseline                                                                 | —     | ✅     | `tools/ortools-baseline/tests/test_solver.py`, `tools/ortools-baseline/tests/test_constraints.py`, `packages/solver/src/baselines/ortoolsBaseline.test.ts` (`serves requests and respects capacity constraints`, `strictly enforces return leg to shelter within shift limit`, `executes reliably on a generated scenario and satisfies invariants`) |
| Results-table script                                                              | —     | ✅     | `packages/solver/src/evaluation/benchmark.test.ts` (`evaluates all solvers across random seeds and generates a results table`), verified via `scenarios/evaluate.ts`                                                                                                                                                                                 |

### Phase 2 — API and database (Under Review 🟡)

| Task                                                    | Owner | Status | Proving test(s)                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------- | ----- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema                                                  | —     | ✅     | `services/api/src/db/schema.test.ts` (migration 001/002 up/down SQL structure, PostGIS extensions, GiST indexes, drop default REAL), `services/api/src/db/integration.test.ts` (live PostgreSQL NOT NULL/default source constraints and check constraints)                                                                                                                                                                                              |
| PostGIS storage                                         | —     | ✅     | `services/api/src/db/repository.test.ts` (parameterized LIMIT/OFFSET with $N placeholders, MAX_QUERY_OFFSET enforcement, seeder SIMULATED provenance), `services/api/src/db/integration.test.ts` (live PostGIS ST_DWithin spatial proximity queries and distance filters)                                                                                                                                                                               |
| Request intake with idempotency and duplicate detection | —     | ✅     | `services/api/src/routes/requests.test.ts` (real Supertest HTTP tests: 201 Created, 400 validation, 409 reused key conflict, idempotent replay, duplicate detection), `services/api/src/openapi.test.ts` (Supertest response schema validation), `services/api/src/db/integration.test.ts` (live PostGIS unique-violation code 23505 race handling)                                                                                                     |
| Assignment endpoints                                    | —     | ✅     | `services/api/src/routes/assignments.test.ts` (real Supertest HTTP tests: 201 propose, 400 rejection when committed frozen stops exist, 200 commit with frozen stops, rollback on injected statement failure, 409 concurrency/conflict, PATCH /stops), `services/api/src/openapi.test.ts` (Supertest response schema validation), `services/api/src/db/integration.test.ts` (live PostgreSQL transaction with SELECT FOR UPDATE row locks and rollback) |
| OpenAPI spec                                            | —     | ✅     | `services/api/src/openapi.test.ts` (byte-for-byte synchronization between docs/openapi.json and services/api/src/openapi.json, Express route introspection anti-drift, real Supertest HTTP validation against 23 response schemas for success and error status codes, schema contract parity with @floodrelay/shared types)                                                                                                                             |

### Phase 3 — Frontend

| Task                                                 | Owner | Status | Proving test(s)                                                                                                                 |
| :--------------------------------------------------- | :---- | :----- | :------------------------------------------------------------------------------------------------------------------------------ |
| Next.js App Router UI Foundation & Stitch Screens    | —     | ✅     | All 8 Google Stitch routes, `apps/web/__tests__/portal-routing.test.ts`, `apps/web/__tests__/fixtures.test.ts`                  |
| Citizen request intake & PostGIS integration         | —     | ✅     | `apps/web/__tests__/citizen-api.test.ts`, browser geolocation, idempotency replay & conflict safety, `verifyMilestone2Live.ts`  |
| Operator Command Center Auth & Dashboard             | —     | ✅     | `apps/web/__tests__/interactions.test.ts`, HttpOnly cookies, session logout revocation, `verifyMilestone3Live.ts`               |
| Interactive GIS Operations Map                       | —     | ✅     | `apps/web/__tests__/operator-map.test.ts`, React Leaflet, CartoDB Dark Matter tiles, layer toggles, incident & craft inspectors |
| Solver proposal generation & human-supervised commit | —     | ✅     | `apps/web/__tests__/assignment-workflow.test.ts`, `verifyMilestone5Live.ts`, ACID row-level locking, stop freezing              |
| Master end-to-end integration & acceptance           | —     | ✅     | `verifyPhase3E2E.ts`, Next.js production build (`next build`), zero type errors, zero lint errors                               |

### Phase 4 — Road network and uncertainty

| Task                                                                     | Owner | Status | Proving test(s)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | ----- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OSRM travel times (check the OSRM docs for the table request size limit) | —     | ✅     | Real road travel times via OSRM MLD backend (`ghcr.io/project-osrm/osrm-backend:v5.27.1`) verified with BBBike New Delhi OSM PBF extract on Docker Compose (`infra/docker-compose.yml --profile osrm`). Verified via `scenarios/osrm-check.ts` (100% road coverage on road vehicles, 0 failed requests) and `packages/solver/src/routing/osrmTravelTime.live.test.ts` (1 passing live integration test, chunking 120 coordinates across 4 table requests). Unit tests and fallback paths verified in `osrmTravelTime.test.ts`, `osrmHttp.test.ts`, `travelTimeFactory.test.ts`, and `assignmentsOsrm.test.ts`. |
| Operator-marked blocked areas                                            | —     | ✅     | `packages/solver/src/routing/blockedZones.test.ts` (34 passing tests: ray-casting point-in-polygon, segment intersection, `HazardAwareTravelTimeProvider` with INFINITE and PENALTY policies, impedance cost scaling table, bounding-box prefilter, 2000-vertex worst case, and `UNREACHABLE_DUE_TO_HAZARD` across all 3 solvers)                                                                                                                                                                                                                                                                              |
| Uncertainty features                                                     | —     | ✅     | `packages/solver/src/routing/uncertainty.test.ts` (14 passing tests: lognormal travel time modeling with CV quadrature, Acklam rational quantile approximation verified within 1e-6 tolerance and symmetry z(1-p) = -z(p), median = exp(mu), `RiskAwareTravelTimeProvider`, correlated-leg Monte Carlo route risk assessment)                                                                                                                                                                                                                                                                                  |
| Perturbation re-runs to report how often assignments change              | —     | ✅     | `packages/solver/src/evaluation/perturbation.test.ts` (7 passing tests: `PerturbedTravelTimeProvider`, timestamp perturbation, plan churn metric computation, verified via `scenarios/perturb.ts` study script)                                                                                                                                                                                                                                                                                                                                                                                                |

### Phase 5 — Incremental updates and live operations

| Task                       | Owner  | Status | Details                                                                                                                                                                                                                                                    |
| -------------------------- | ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event handlers (backend)   | Part 1 | ✅     | `OperationalEventService`, `operational_events` table (migration 004), 7 validated event types, atomic transactional writes with domain entities and audit records, deduplication via idempotency keys                                                     |
| Roles & Authorization      | Part 1 | ✅     | Centralized RBAC matrix across `OPERATOR`, `DISPATCHER`, `ADMIN` with `requirePermission(...)` middleware; role-based redaction of sensitive metadata in audit logs                                                                                        |
| Audit log                  | Part 1 | ✅     | Paginated and filtered `GET /audit/events` endpoint, atomic audit recording on all domain operations                                                                                                                                                       |
| Frozen committed stops     | Part 1 | ✅     | Invariant preserved across all operational events; cancellation and status updates reject tampering with active committed missions                                                                                                                         |
| Local repair contracts     | Part 1 | ✅     | `RepairInput`, `RepairResult`, and `RepairOrchestrationService` interface boundary established; 503 `REPAIR_ENGINE_UNAVAILABLE` until solver integration                                                                                                   |
| Local repair algorithm     | Part 2 | ✅     | `insertRequestBestFeasible`, `repairResourceOffline`, `repairRequestCancellation`, `repairRoadBlockage` — deterministic incremental repair with complete frozen-stop physical invariants (coords <= 1e-4, stop numbers, passenger counts, route retention) |
| Churn calculations         | Part 2 | ✅     | `calculateIncrementalChurn()` with deterministic tie-breaking, three-strategy benchmark CLI harness (`runIncrementalBenchmarkCli.ts`, exported to JSON/CSV/Markdown)                                                                                       |
| Solver backend integration | Part 2 | ✅     | `IncrementalRepairSolverAdapter` passes hazard-aware travel times, recovers authoritative committed baselines, exposes `proposalId` and `churn`, safely triages duplicate flags (10 unit tests)                                                            |
| Live PostGIS verification  | Part 2 | ✅     | `incrementalRepairIntegration.test.ts` (7 live integration tests across Scenarios A-G: REQUEST_CREATED, RESOURCE_OFFLINE, ROAD_BLOCKED, REQUEST_FLAGGED_DUPLICATE, concurrency 409, infeasible, RBAC)                                                      |
| Live dashboard updates     | Part 3 | ⬜     | Implemented in PR #23                                                                                                                                                                                                                                      |

### Phase 6 — Hardening and documentation

| Task                                        | Owner | Status | Details                                                                                                                                                                                                                                                                          |
| ------------------------------------------- | ----- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Redis queue only if measurements justify it | —     | ✅     | Evaluated via empirical benchmarks (< 2.7 ms repair, < 21 ms event loop lag); deferred in favor of PostgreSQL ACID outbox (ADR-42)                                                                                                                                               |
| Optional flood-forecast context layer       | —     | ✅     | Implemented ECMWF Copernicus GloFAS 4.0 gridded river discharge context via Open-Meteo for Delhi Yamuna corridor; informational context only; zero autonomous dispatch (ADR-41); strict cache provenance isolation, calendar date validation, and hook race condition safeguards |
| Load tests                                  | —     | ✅     | Grafana k6 test suite in `tests/load/` with 4 profiles (`smoke`, `baseline`, `stress`, `scalability`); verified with 0 errors, 0 frozen-stop violations, p95 82.58ms at 30 VUs                                                                                                   |
| CI                                          | —     | ✅     | Hardened `.github/workflows/ci.yml` with separate production dependency audit gate (0 vulnerabilities on `--omit=dev --audit-level=high`), critical audit, secrets checks, multi-workspace production builds, live PostGIS demo CLI verification, and automated k6 smoke check   |
| Limitations page                            | —     | ✅     | Public `/limitations` route disclosure, responsive & WCAG AAA accessible, integrated into Citizen footer and Operator navigation with 14 unit tests                                                                                                                              |
| Demo script                                 | —     | ✅     | Reproducible demonstration system (`tools/demo/`), simulation preview mode (ADR-41), durable manifest tracking with operator ownership protection, failure-atomic recovery, and real PostGIS/solver integration suite (ADR-40)                                                   |

---

## 9. Current status

- **Last completed:** Phase 6 Final Hardening & Audit Verification ✅ (PR #30). Phase 5 Part 2 Finalized & Safety Verified ✅ (PR #25). Phase 5 Part 3 merged (PR #23). Phase 5 Part 1 merged (PR #22).
- **Next up:** Faculty demonstration, presentation walkthrough, and production deployment readiness.
- **Phase 0:** Complete ✅.
- **Phase 1:** Complete (8 of 8 tasks complete ✅).
- **Phase 2:** Complete (PR #17 review fixes merged ✅).
- **Phase 3:** Complete (All 6 tasks complete ✅).
- **Phase 4:** Complete ✅.
- **Phase 5 Part 1:** Complete ✅ (merged PR #22).
- **Phase 5 Part 2:** Complete ✅ (PR #25).
- **Phase 5 Part 3:** Complete ✅ (merged PR #23).
- **Phase 6:** Complete ✅ (PR #30 final hardening verified).

---

## 10. Team

| Member | Role | Current task |
| ------ | ---- | ------------ |
|        |      |              |
|        |      |              |
|        |      |              |
|        |      |              |

> **Suggested roles:** backend, geo/algorithms, frontend/map, DevOps/quality/docs.

---

## 11. Decisions made

| Decision                                                   | Reason                                                                                                                                                                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Next.js + React frontend                                   | University requirement                                                                                                                                                                                                                     |
| Separate Node.js backend                                   | Long-running work and live updates do not fit serverless; stronger backend story                                                                                                                                                           |
| PostgreSQL + PostGIS                                       | Spatial queries, built-in DBSCAN for verification                                                                                                                                                                                          |
| No machine learning                                        | Reliable deterministic algorithms preferred; no measured need for ML                                                                                                                                                                       |
| Build solver and evaluation before infrastructure          | Validate the core logic before adding queues, real-time layers, etc.                                                                                                                                                                       |
| Operator commits assignments                               | Decision support only; the system never dispatches autonomously                                                                                                                                                                            |
| Backend framework: Express with TypeScript                 | Team knows Express, setup is minimal, effort goes to the solver; TypeScript strict mode shared across all packages catches field mismatches at compile time; framework can be changed later because the solver has no framework dependency |
| Shelter drop-off model                                     | Intermediate safe shelter drop-off stops inserted when vehicle passenger capacity is reached during multi-trip dispatching (ADR-11)                                                                                                        |
| Flood impedance multipliers                                | Travel impedance multiplier (ASSUMED_FLOOD_IMPEDANCE_MULTIPLIER = 1.5) applied to travel times in flood-affected zones (ADR-12)                                                                                                            |
| PostGIS schema and plain SQL migrations                    | GEOGRAPHY(Point, 4326) with GiST spatial indexes, plain SQL migrations with transactional runner, strict alignment with @floodrelay/shared (ADR-13)                                                                                        |
| Request intake validation and duplicate detection          | Zod coordinate bounds, DB idempotency keys, spatial-temporal duplicate flagging (<=100m, <=2h, +-2 people) without dropping records, unverified submissions retained (ADR-14)                                                              |
| Operator-committed assignments and stop-freezing lifecycle | Solver only proposes; operator action commits, freezes stops, marks requests ASSIGNED, subsequent replans preserve frozen stops (ADR-15)                                                                                                   |
| OpenAPI 3.1 specification and anti-drift testing           | OpenAPI 3.1 spec served at /openapi.json and validated via automated route-introspection tests against Express handlers (ADR-16)                                                                                                           |
| Deterministic resource locking and rollback verification   | Row-level SELECT FOR UPDATE in ascending order on resources, late statement rollback verification, explicit provenance (ADR-19)                                                                                                            |
| Two-phase async prefetch with sync solvers                 | Decouple async HTTP I/O from tight synchronous solver loops via memory cache (ADR-20)                                                                                                                                                      |
| Per-resource-type routing policy                           | Road vehicles follow OSRM road graph; boats and helicopters use straight-line geodesic calculations by design (ADR-21)                                                                                                                     |
| Dual hazard policies (INFINITE vs PENALTY)                 | Strict safety exclusion under INFINITE (default); optional heavy impedance (10.0x) under PENALTY for triage overrides (ADR-22)                                                                                                             |
| Lognormal risk model with quadrature                       | Multiplicative non-negative transit delays modeled via lognormal distribution and Acklam rational approximation (ADR-23)                                                                                                                   |
| Request-scoped hazard zones & audit hashing                | Polygon zones provided per-proposal; SHA-256 canonical JSON hash logged in ASSIGNMENT_PROPOSED audit payload; frozen stops preserved (ADR-24)                                                                                              |
| 500-point prefetch ceiling                                 | Bound OSRM table prefetch coordinates to prevent excessive API latency; Large scenario falls back to straight-line (ADR-25)                                                                                                                |
| Deterministic perturbation noise model                     | Uniform noise in [1-m, 1+m] deterministic per (seed, from, to) pair to benchmark route and sequence churn reproducibly (ADR-26)                                                                                                            |
| Transactional operational events outbox                    | PostgreSQL table `operational_events` updated atomically with domain and audit writes in single transaction client; no external queue in Part 1 (ADR-27)                                                                                   |
| Centralized RBAC and audit redaction                       | Strict permission matrix across OPERATOR, DISPATCHER, ADMIN with `requirePermission(...)` middleware; automatic redaction of sensitive metadata for OPERATOR role (ADR-28)                                                                 |
| Incremental solver repair boundary                         | Decoupled `RepairInput`/`RepairResult` interfaces; explicit HTTP 503 `REPAIR_ENGINE_UNAVAILABLE` signaling until Part 2 solver integration (ADR-29)                                                                                        |
| Deterministic best-feasible insertion                      | Ordered tie-breaking across objectiveScore, incremental distance, resource ID, and stop indices; 15-minute new-route penalty (ADR-30)                                                                                                      |
| Frozen-stop physical invariants in solver layer            | Immediate rejection with NO_FEASIBLE_REPAIR if candidate alters, removes, reassigns or shifts coords of isFrozen stops (ADR-31)                                                                                                            |
| Assignment churn metric definition                         | Churn rate evaluated over baseline served requests only; benchmark proves 0 frozen violations for event-triggered repair (ADR-32)                                                                                                          |
| Incremental repair adapter integration                     | Pure solver decoupled from Express/SQL; adapter maps inputs, recovers baselines, persists proposals (ADR-33)                                                                                                                               |
| Live Polling with Visibility API & Bounded Backoff         | 20s live polling hook with Page Visibility API pausing, bounded exponential backoff (capped at 60s), AbortController cancellation on unmount, and monotonic sequence deduplication to prevent stale overwrites (ADR-34)                    |
| Human-in-the-Loop Repair Proposal & Churn Visualization    | Explicit side-by-side plan diff with churn percentage gauge, categorized stop status badges (FROZEN, ADDED, REMOVED, REASSIGNED, REORDERED, UNCHANGED), and SLA/wait time delta metrics (ADR-35)                                           |
| Test Fixture Isolation & Safe 503 Solver Fallback          | When `POST /operations/repair` returns 503 during Part 2 solver development, frontend surfaces a clear status banner and provides an isolated preview fixture with database commitment strictly blocked (ADR-36)                           |
| Authoritative Resource & GIS Layer Isolation               | Segregated reference assets from live database records, disclosed missing `GET /operations/resources` endpoint, protected against synthetic ID mutation, and isolated GIS tactical map layers (ADR-37)                                     |
| Duplicate flag triage safety policy                        | Flagging duplicate preserves mutable and committed stops intact; returns NO_FEASIBLE_REPAIR with triage warning awaiting human review (ADR-38)                                                                                             |
| Hazard-aware travel-time routing in repair                 | Incremental solver uses asynchronous road-aware / hazard-aware travel times; falls back to straight-line with explicit warning (ADR-39)                                                                                                    |
| Authoritative baseline reconstruction & repair comparison  | Recovers latest committed assignment if baselineId omitted; returns proposalId, churn, warnings for Part 3 UI comparison (ADR-40)                                                                                                          |
| River discharge flood forecast context layer               | ECMWF Copernicus GloFAS 4.0 gridded river discharge context via Open-Meteo for Delhi Yamuna corridor; informational only; zero autonomous dispatch (ADR-41)                                                                                |
| Asynchronous queue evaluation & deferral                   | Benchmarked solver repair (< 2.7 ms) and event-loop lag (< 21 ms); deferred Redis/BullMQ in favor of PostgreSQL ACID outbox (ADR-42)                                                                                                       |

---

## 12. Open questions

- [ ] Confirm with faculty that a separate Node backend is acceptable alongside the mandatory Next.js and React.
- [ ] Which district or river basin do we use for scenarios?
- [ ] Who owns each role above?
- [x] How will boats be modelled, given OSRM has no boat profile? Resolved in ADR-21: boats and helicopters use StraightLineTravelTimeProvider by design; only road vehicles query OSRM road distance.

---

## 13. Known limitations

- Demo rescue requests are simulated.
- OSRM uses static map data, so it does not know which roads are flooded; operators mark blocked areas and routes crossing them are flagged.
- No live traffic.
- Results are from simulated scenarios and are not field-validated.

---

## 14. How to update this file

Update `progress.md` in the same pull request that completes a task. Move items between ⬜, 🟡 and ✅, update "Last updated", "Current focus" and "Current status", and add any new decision to section 11.
