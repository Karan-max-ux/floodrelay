# Architecture Decision Log

## Template

When recording a new decision, copy this template and fill it in:

```
### ADR-<number>: <Title>

- **Date:** YYYY-MM-DD
- **Decision:** What was decided.
- **Context:** Why this decision was needed.
- **Alternatives considered:** What else was evaluated.
- **Consequence:** What follows from this decision.
```

---

### ADR-1: Next.js + React frontend

- **Date:** 2026-10-10
- **Decision:** Use Next.js (App Router) with React and TypeScript for the frontend.
- **Context:** The university requires Next.js and React.js for the project.
- **Alternatives considered:** None; this is a mandatory requirement.
- **Consequence:** Frontend must use the Next.js App Router and React component model.

---

### ADR-2: Separate Node.js backend

- **Date:** 2026-10-10
- **Decision:** Run a separate Node.js backend service rather than using Next.js API routes for all server logic.
- **Context:** The system needs long-running solver computations and live update channels (polling, then Socket.IO). These do not fit well into serverless or edge function models.
- **Alternatives considered:** Next.js API routes only; serverless functions.
- **Consequence:** Two deployable units (frontend and backend). Stronger separation of concerns and a clearer backend story for the portfolio.

---

### ADR-3: PostgreSQL + PostGIS

- **Date:** 2026-10-10
- **Decision:** Use PostgreSQL with PostGIS for the database.
- **Context:** The system requires spatial queries (nearest neighbours, bounding boxes, distance calculations). PostGIS also provides a built-in DBSCAN implementation that can be used to verify our own clustering.
- **Alternatives considered:** MongoDB with geospatial indexes; SQLite with SpatiaLite.
- **Consequence:** Requires running a PostgreSQL instance (via docker-compose for development). The team needs basic familiarity with spatial SQL.

---

### ADR-4: No machine learning

- **Date:** 2026-10-10
- **Decision:** Do not use machine learning. Use reliable deterministic algorithms.
- **Context:** No measured need for ML has appeared. Deterministic algorithms are easier to test, debug, explain, and reproduce.
- **Alternatives considered:** Demand prediction models; ML-based routing.
- **Consequence:** All outputs are the result of deterministic algorithms. This may be revisited if a measured need appears.

---

### ADR-5: Build solver and evaluation before infrastructure

- **Date:** 2026-10-10
- **Decision:** Implement and evaluate the solver library before adding infrastructure such as queues, real-time layers, or routing servers.
- **Context:** The core value of the project is the allocation logic. Validating it early with a test harness reduces risk. Infrastructure can be added when measurements or features require it.
- **Alternatives considered:** Building the full stack end-to-end first.
- **Consequence:** The solver is developed and tested as a standalone library (`packages/solver`) with no database, HTTP, or UI dependencies.

---

### ADR-6: Operator commits assignments

- **Date:** 2026-10-10
- **Decision:** The system proposes assignments, but a human operator must review and commit them before they are dispatched.
- **Context:** This is a decision-support tool, not an autonomous dispatch system. Human oversight is required for safety and accountability.
- **Alternatives considered:** Automatic dispatch with operator override.
- **Consequence:** The UI must clearly present proposed vs. committed assignments. Committed or dispatched stops are frozen and not reshuffled by re-optimization.

---

### ADR-7: Backend framework: Express with TypeScript

- **Date:** 2026-10-15
- **Decision:** Use Express with TypeScript (strict mode) as the backend framework.
- **Context:** The team needed to pick a backend framework for the separate Node.js service. The team already knows Express, and setup is minimal. The main effort goes to the solver and allocation workflow, not framework features. TypeScript with strict mode is used across all packages (api, solver, web) so that shared types catch field mismatches at compile time.
- **Alternatives considered:** Fastify (faster, schema-based validation, but less team familiarity); NestJS (more structure, but heavier and more opinionated than needed); plain JavaScript (no compile-time type checking across packages).
- **Consequence:** The backend uses Express with TypeScript. The framework can be changed later because the solver has no framework dependency and the API surface is small at this stage.

---

### ADR-8: Node.js 24 LTS

- **Date:** 2026-10-15
- **Decision:** Standardize on Node.js 24 LTS across development, monorepo packages, and CI (enforced via `.nvmrc` and root `package.json` `engines`).
- **Context:** A reliable, modern LTS version of Node.js is required for monorepo development and GitHub Actions CI.
- **Alternatives considered:** Node 22 (maintenance LTS); Node 26 (entering LTS in late October 2026); Node 20 (end-of-life).
- **Consequence:** Developers and CI runners must use Node.js 24+.

---

### ADR-9: npm workspaces

- **Date:** 2026-10-15
- **Decision:** Use npm workspaces for managing monorepo packages (`apps/*`, `services/*`, `packages/*`).
- **Context:** The project needs cross-package linking (`@floodrelay/solver` -> `@floodrelay/shared`) and unified scripts (`lint`, `typecheck`, `test`) without requiring extra package managers.
- **Alternatives considered:** pnpm (requires separate tool installation and store semantics); yarn (adds another CLI dependency when npm is already bundled with Node).
- **Consequence:** Dependency management and script orchestration rely solely on standard npm with zero additional global tooling needed.

---

### ADR-10: ESLint (flat config) + Prettier + Vitest

- **Date:** 2026-10-15
- **Decision:** Use ESLint with typescript-eslint flat config for linting, Prettier for formatting, and Vitest for testing packages.
- **Context:** Need consistent code style, static analysis, and fast unit test execution across TypeScript ES modules without complex transpilation setups.
- **Alternatives considered:** Jest (slower, requires extra Babel or ts-jest transform configuration for native ESM and TypeScript).
- **Consequence:** Fast, modern test execution with native TypeScript and ESM support in Vitest, and clean separation between code formatting and linting rules.

---

### ADR-11: Shelter drop-off model

- **Date:** 2026-10-20
- **Decision:** Model vehicle capacity constraints with intermediate shelter drop-off stops. When a rescue vehicle reaches its passenger capacity (or concludes servicing a localized cluster of requests), it routes to a designated safe shelter to disembark evacuees before servicing further requests or returning to its home depot.
- **Context:** Rescue vehicles (inflatable boats, high-water trucks) have finite passenger capacities (typically 6ΓÇô18 people). In severe flooding events with hundreds of stranded victims, a vehicle cannot execute a continuous tour without offloading evacuees. Routing models must explicitly account for intermediate shelter drop-off trips to protect passenger safety and avoid vehicle overloading.
- **Alternatives considered:**
  - Single-trip routing: Each vehicle performs at most one pickup leg from depot, offloads once, and halts. (Rejected: extremely inefficient resource utilization during large-scale operations).
  - Infinite vehicle capacity: Route vehicles purely to minimize distance without capacity boundaries or shelter drop-offs. (Rejected: physically impossible and unsafe in real flood rescues).
- **Consequence:** Routing algorithms (Nearest-First, Urgency-batched savings + 2-opt, Cluster Allocation) maintain current passenger load and insert shelter drop-off stops whenever servicing an additional request would exceed vehicle capacity.

---

### ADR-12: Flood impedance multipliers

- **Date:** 2026-10-20
- **Decision:** Use a configurable travel impedance multiplier (`ASSUMED_FLOOD_IMPEDANCE_MULTIPLIER = 1.5`) applied to geodesic/network travel estimates when routing through flood-affected or waterlogged zones.
- **Context:** Flood conditions degrade vehicular speeds due to submerged debris, reduced traction, water resistance, and caution required by operators. Simple dry-road network routing or unweighted geodesic distances significantly underestimate real-world mission duration during active flooding emergencies.
- **Alternatives considered:**
  - Binary passable/impassable road edges only: Treat flooded roads as strictly blocked (infinite travel time). (Rejected: specialized high-water trucks and rescue boats can traverse certain flooded corridors, and strictly blocking all flooded areas can cause solver infeasibility).
  - Static dry-road speeds: Use standard unweighted road speeds everywhere. (Rejected: dangerous optimism leading to unrealistic ETAs and unachievable dispatch schedules).
- **Consequence:** Travel time providers support impedance scaling for flooded segments, and all speed and impedance parameters are explicitly exported as uncalibrated placeholder assumptions (`ASSUMED_*`) documented in `docs/limitations.md`.

---

---

### ADR-13: Database schema, PostGIS spatial indexing, and SQL migration strategy

- **Date:** 2026-10-27
- **Decision:** Use plain SQL migrations (`infra/migrations/`) executed via a lightweight runner (`services/api/src/db/migrator.ts`), `node-postgres` (`pg`) connection pooling, and PostGIS `GEOGRAPHY(Point, 4326)` columns with spatial GiST indexes for all location entities. Keep table schemas and columns strictly aligned with `@floodrelay/shared` data contracts.
- **Context:** Phase 2 requires persistent storage for citizen rescue requests, fleet resources, safe shelters, solver assignment proposals, route stops, and an audit event log. PostGIS spatial functions (`ST_DWithin`, `ST_Distance`) are best queried with native SQL without ORM abstraction penalties.
- **Alternatives considered:**
  - Prisma / Drizzle ORM: Heavier abstraction layers with evolving spatial geometry types; higher cognitive overhead when debugging raw spatial SQL.
  - Geometry vs Geography: Using `GEOMETRY` with flat Euclidean projections requires managing SRID projections. `GEOGRAPHY(Point, 4326)` calculates true spherical distances in meters natively.
- **Consequence:** Database tables (`requests`, `resources`, `shelters`, `assignments`, `assignment_stops`, `audit_events`) have spatial GiST indexing, supporting sub-millisecond proximity queries, duplicate detection within radial meters, and strict alignment with TypeScript interfaces in `@floodrelay/shared`.

---

### ADR-14: Request intake validation, idempotency, and non-destructive duplicate detection

- **Date:** 2026-10-27
- **Decision:** Validate citizen rescue requests using Zod with coordinate and schema bounds, enforce intake idempotency via database `idempotency_key` lookups, and detect spatial-temporal duplicates (distance $\le 100\text{ m}$, submission window $\le 2\text{ hours}$, passenger delta $\le 2$ people). Flagged duplicate requests and unverified submissions are always stored in the database with their respective flags (`is_flagged_duplicate: true`, `duplicate_of_id`, `verification_status: 'UNVERIFIED'`) and are never silently discarded or dropped.
- **Context:** Emergency intake endpoints face erratic network conditions causing client retries, as well as multiple reports from neighbors or family members for the same stranded individuals. Discarding any call risks life safety if a duplicate classification is mistaken; simultaneously, dispatching multiple rescue boats to identical locations wastes scarce emergency capacity. Idempotency prevents duplicate records from client retry loops, while audit logging preserves every submission event.
- **Alternatives considered:**
  - Silent deduplication / dropping duplicate submissions: Rejected because false-positive drops during life-or-death emergencies could leave victims unserved.
  - Ephemeral in-memory idempotency cache: Rejected because node restarts or multi-instance deployments lose idempotency keys; database persistence ensures durable idempotency.
- **Consequence:** Requests are reliably persisted with full audit traceability (`audit_events` logged for every creation and duplicate flag). Operators retain complete visibility to inspect unverified or flagged submissions before or during solver dispatch runs.

---

### ADR-15: Operator-committed assignments and stop-freezing lifecycle

- **Date:** 2026-10-28
- **Decision:** Allocation endpoints run the solver solely to propose assignment plans (`status: 'PROPOSED'`). Only an explicit operator action via `POST /assignments/:id/commit` transitions an assignment to `COMMITTED`, freezes all route stops (`is_frozen = true`), and marks served requests as `ASSIGNED`. Once committed, an assignment cannot be re-committed or mutated, and subsequent replanning cycles (`POST /assignments/propose` with `preserveFrozen: true`) preserve frozen stops at the head of vehicle routes.
- **Context:** Emergency dispatch decisions carry severe legal and ethical consequences during active flood disasters. Autonomous dispatch risks directing first responders into dangerous, rapidly changing hazard areas without human verification. Requiring human-in-the-loop operator commitment ensures operational authority remains with dispatchers while freezing dispatched stops ensures vehicles are not disrupted or redirected mid-mission.
- **Alternatives considered:**
  - Autonomous dispatch: Solver immediately commits and dispatches resources without operator review. (Rejected: unsafe in volatile flood disasters where ground truth overrides model assumptions).
  - Mutable committed plans: Allow unconstrained editing of committed stops without audit trail or freeze enforcement. (Rejected: creates fleet confusion and dispatch churn).
- **Consequence:** Clear lifecycle separation between solver proposals and human operator commits, with full audit logging (`ASSIGNMENT_PROPOSED`, `ASSIGNMENT_COMMITTED`, `ASSIGNMENT_STOP_MODIFIED`) and stop-freezing invariants during dynamic replanning.

---

### ADR-16: OpenAPI 3.1 specification and automated anti-drift validation

- **Date:** 2026-10-28
- **Decision:** Document all platform endpoints using OpenAPI 3.1 (`docs/openapi.json` and served over HTTP at `GET /openapi.json`), backed by an automated test suite (`services/api/src/openapi.test.ts`) that introspects Express routes and validates bidirectional alignment between registered endpoints and specification.
- **Context:** API specifications frequently diverge from actual code as endpoints evolve, breaking downstream frontend interfaces and client integrations. An automated test validates that registered Express endpoints have matching documentation, helping detect undocumented routes or stale endpoints.
- **Alternatives considered:**
  - Manual unverified documentation: Rejected because manual docs drift within days of development.
  - Runtime decorator generators (e.g. tsoa, routing-controllers): Adds invasive decorators, extra compilation steps, and unnecessary runtime reflection overhead.
- **Consequence:** OpenAPI document is kept aligned with code, automatically validated in CI/tests, and served live from the backend API for client discovery and UI generation.

---

### ADR-17: Google OR-Tools Python Baseline Formulation and Child-Process Integration

- **Date:** 2026-10-23
- **Decision:** Implement an optimization baseline using Google OR-Tools in Python (`ortools.constraint_solver.pywrapcp`), integrated with the TypeScript solver package via a child process (`child_process.spawnSync`).
- **Context:** Phase 1 required an established optimization baseline to benchmark against our custom heuristics (Nearest-First, Urgency-batched savings + 2-opt, Cluster-Allocation). OR-Tools is an industry standard for Vehicle Routing Problems (VRP) and Pickup and Delivery Problems (PDP). Formulating rescue operations as a multi-vehicle PDP with capacity and time dimensions provides a formal mathematical optimization baseline using constraint programming and metaheuristic routing search to evaluate heuristic dispatch quality, high-priority wait times, and travel efficiency.
- **Alternatives considered:**
  - TypeScript LP/MIP solvers (e.g. javascript-lp-solver): Lack native routing dimension support, vehicle routing metaheuristics, and perform poorly on non-trivial VRP instances.
  - Persistent Python microservice / REST server: Running a background HTTP daemon for baseline evaluation introduces unnecessary operational complexity, port conflicts, and dependency management for library-level solver tests.
  - Shell string interpolation (`child_process.exec`): Vulnerable to command injection and platform discrepancies across Windows and Linux environments.
- **Consequence:** Clean decoupling where the Python solver operates as a standalone CLI tool reading/writing JSON via stdin/stdout, while the TypeScript wrapper (`solveOrToolsBaseline`) provides a seamless synchronous interface conforming to `SolverFn` with zero native binding complexity. Requires Python 3.10+ with `ortools` installed in the development and CI environments.

---

### ADR-18: Rejection of Frozen Route Preservation for Greedy and Savings Baselines

- **Date:** 2026-10-29
- **Decision:** Reject attempts to propose assignments using the `nearest-first` or `savings` baseline algorithms with HTTP 400 (`UNSUPPORTED_ALGORITHM_OPTION`) whenever committed frozen stops exist in the active scenario, or when `preserveFrozen: true` is explicitly requested. Operators requiring incremental replanning around committed stops must use `cluster-allocation` or explicitly pass `preserveFrozen: false` to recalculate entirely from scratch.
- **Context:** The Nearest-First greedy heuristic and Clarke-Wright savings baseline construct route networks ab initio and do not model fixed initial partial routes or committed frozen waypoints. Allowing these baseline solvers to run while committed stops exist would either silently ignore the frozen stops (leading to disjoint dispatches and conflicting vehicle assignments) or fail downstream constraints. Explicit rejection provides unambiguous feedback to operators.
- **Alternatives considered:**
  - Silently disregard frozen stops: Rejected because committed rescue units would have their active tasks dropped or reassigned, violating dispatch integrity.
  - Artificially prepend frozen stops to baseline routes without re-optimizing: Rejected because greedy and savings heuristics cannot enforce capacity or shift limit compliance when prepended with arbitrary prior routes.
- **Consequence:** Clear algorithm capability contracts: `cluster-allocation` supports incremental operations with frozen stops; `nearest-first` and `savings` serve as pure initial baselines.

---

### ADR-19: Deterministic resource-level locking and transactional rollback verification

- **Date:** 2026-10-30
- **Decision:** In `commitAssignment()`, acquire exclusive PostgreSQL row locks (`SELECT ... FOR UPDATE`) on the assignment row, all referenced request rows (in ascending ID order), and all referenced resource rows (in ascending ID order) within a single database transaction. Recheck for resource assignment conflicts after locks are acquired before applying status transitions. Wrap the entire workflowΓÇöassignment status update, stop freezing, request assignment, and audit event insertionΓÇöin a PostgreSQL transaction that performs full rollback on any intermediate failure.
- **Context:** Concurrent operator proposals may allocate the same rescue resource or request. Without deterministic row-level locking on resources, concurrent commits of different proposals using the same resource could commit simultaneously, causing double-allocation. Ordering lock acquisitions lexicographically minimizes transaction deadlocks.
- **Alternatives considered:**
  - Optimistic concurrency control (version column): Adds retry loops and requires client-side conflict resolution.
  - Table-level locking: Serializes all assignment operations across the system, creating extreme contention.
- **Consequence:** Two proposals using the same resource for different requests cannot commit concurrently; one commits while the other fails deterministically with HTTP 409 `RESOURCE_ALREADY_COMMITTED`. Transaction rollback is verified against live PostGIS ensuring partial database writes revert cleanly on late statement failure.

#### Update: Review Fix Hardening and Verification (2026-10-30)

- **Deterministic Lock Ordering:** Lock acquisition sequence is strictly ordered: assignment row -> request rows (ordered by ID `COLLATE "C"` ascending) -> resource rows (ordered by ID `COLLATE "C"` ascending). Collation ordering equivalence with JavaScript `.sort()` is verified for ASCII identifiers (tested by `proves identical lock acquisition ordering between JS .sort() and PostgreSQL COLLATE "C" across mixed-case, numbers, and underscores`).
- **Live Overlap Verification:** Concurrency conflict prevention is verified with live transaction overlap using a monitoring connection polling `pg_stat_activity` for `wait_event_type = 'Lock'` (tested by `prevents two different proposals using the same resource for different requests from committing concurrently via genuine overlapping transactions`).
- **Bidirectional Frozen-Stop Lineage:** Implemented three verification checks: Check 1 rejects frozen stops on resources with no prior commitments (defense-in-depth); Check 2 enforces preservation of all prior committed stops; Check 3 enforces lineage verification for both `PICKUP` and `DROPOFF` stops. Duplicate pickups for the same request across stops within a plan are rejected.
- **Scoped Rollback Verification:** Rollback after partial writes is verified using a test-scoped PostgreSQL trigger (`trg_test_fail_audit`) and function (`fn_test_fail_audit()`) conditioned on the specific assignment ID. Cleanup is enforced in `beforeAll`, `finally`, and `afterAll`. Testing confirmed that omitting `ROLLBACK` on error was detected indirectly: the connection remained in aborted transaction state `25P02` and failed on subsequent query reuse rather than by an immediate outcome assertion.
- **Known Limitations Recorded:** Acknowledged residual concurrency race in un-locked `modifyStop()`, ASCII-only lock order verification, deferred request lifecycle transitions (`IN_TRANSIT`, `RESCUED`), and absence of assignment retirement workflow prior to Phase 3.

---

### ADR-20: Two-Phase Async Prefetch with Synchronous Solvers

- **Date:** 2026-11-01
- **Decision:** Decouple travel-time retrieval from solver execution into two distinct phases: an asynchronous `prefetch()` phase that queries external routing engines (e.g., OSRM Table API) or caches to build an in-memory matrix cache, followed by synchronous solver execution where `getTravelEstimate()` lookups are purely synchronous reads from memory.
- **Context:** Routing algorithms like Clarke-Wright savings, 2-opt local search, and greedy nearest-first perform hundreds of thousands of distance lookups in tight loops. Making solvers async or making an async I/O call per distance lookup would introduce massive async microtask overhead, context switching, and unpredictable network latency inside search loops. Solvers remain deterministic, easily testable pure functions without network dependencies.
- **Alternatives considered:**
  - _Async solvers_: Make all solver functions async and `await provider.getTravelEstimate(...)` on every leg evaluation. Rejected due to extreme performance degradation (network I/O in local search loops) and inability to maintain clean synchronous unit testing.
  - _Full precomputation matrix_: Compute all N x N pairs upfront before every solve regardless of fleet size. Rejected because scenarios with hundreds of requests and resources would hit external API limits or consume unnecessary compute for points never considered.
- **Consequence:** Solvers remain fast, synchronous, and pure. External network calls are isolated to a single prefetch step before routing begins.

---

### ADR-21: Per-Resource-Type Routing Policy

- **Date:** 2026-11-01
- **Decision:** Enforce routing policies partitioned strictly by physical resource capability: road vehicles (`HIGH_WATER_VEHICLE`, `AMBULANCE`) query OSRM road distance scaled by vehicle speed; marine craft (`BOAT`) and aerial craft (`HELICOPTER`) strictly use `StraightLineTravelTimeProvider` (geodesic distance with speed scaling) by design. Scenarios containing only marine or aerial resources dispatch zero OSRM requests.
- **Context:** OSRM driving profiles snap coordinates to navigable roads and compute paths along street networks. In flood emergencies, boats navigate open water, flooded plains, or canal channels, while helicopters fly straight lines. Forcing boats or helicopters to follow road networks or scaling car durations by boat speeds produces absurd routes that follow switchbacks, one-way streets, or detours where open direct lines are physically traversed.
- **Alternatives considered:**
  - _Uniform OSRM routing with speed scaling_: Query OSRM for all vehicles and scale car duration by `roadDistance / resourceSpeed`. Rejected because boats and helicopters do not follow roads.
  - _Multi-profile OSRM instances_: Deploy separate OSRM instances with custom maritime and aviation profiles. Rejected as unfeasible without hydrographic navigational data, elevation barriers, and air traffic control constraints.
- **Consequence:** Dispatchers receive realistic travel estimates aligned with each resource's physical environment. Road coverage statistics evaluate road vehicles only.

---

### ADR-22: Hazard Policies (INFINITE vs PENALTY)

- **Date:** 2026-11-01
- **Decision:** Support two distinct operational policies for impassable hazard zones (`BLOCKED`):
  1. `INFINITE` policy (default): Legs intersecting a blocked polygon receive `distance = Infinity`, `duration = Infinity`, and `blocked = true`. Solvers strictly reject these legs, and enclosed requests are marked `UNREACHABLE_DUE_TO_HAZARD`.
  2. `PENALTY` policy: Impassable legs receive finite heavy impedance: `baseCost * penaltyMultiplier` (default 10.0x, placeholder), allowing routing if no safe alternative exists.
     Mild hazards (`CAUTION` = 1.25x, `WATER_SURGE` = 2.0x) apply constant impedance multipliers under both policies.
- **Context:** In flash floods, some routes are physically blocked (collapsed bridges, raging currents). Under strict safety constraints (`INFINITE`), dispatchers must never direct vehicles through lethal danger. However, in catastrophic triage emergencies where leaving people stranded is worse than taking a risky passable detour, operators may opt to evaluate high-cost paths under `PENALTY`.
- **Alternatives considered:**
  - _Single hard exclusion (infinite only)_: Make all blocked zones non-traversable without override. Rejected because emergency operations sometimes require soft penalties when road clearance teams accompany convoys.
  - _Dynamic road re-weighting in OSRM_: Update OSRM graph edge weights dynamically. Rejected due to the operational complexity of live graph rebuilds or MLD cell customizations during active incidents.
- **Consequence:** Solvers reliably distinguish between physical capacity exhaustion and geographic isolation due to hazards.

---

### ADR-23: Lognormal Travel Time Risk and Uncertainty Model

- **Date:** 2026-11-01
- **Decision:** Model emergency travel time variability using a lognormal distribution parameterized by planned mean duration and an effective coefficient of variation (CV_effective) computed via quadrature:
  cv_effective = sqrt(cv_base^2 + cv_depth^2 + cv_weather^2 + cv_congestion^2 + cv_hazard^2).
  Evaluate risk percentiles (e.g. P90, P95) using Peter J. Acklam's inverse standard normal CDF rational approximation (accurate to relative error ~ 1.15e-9).
- **Context:** Emergency transit durations are strictly positive, right-skewed, and exhibit heavy tails due to water surges, debris, and congestion. Gaussian models incorrectly assign non-zero probability to negative travel times. The lognormal distribution naturally models multiplicative delays while preserving non-negativity. Quadrature combination allows orthogonal environmental factors to contribute smoothly to variance.
- **Alternatives considered:**
  - _Gaussian / Normal distribution_: Rejected because standard deviations for high-uncertainty legs can produce negative travel durations.
  - _Empirical Monte Carlo sampling_: Draw random delay factors from empirical distributions. Rejected for real-time routing because quantile evaluations must be fast and closed-form during dispatch proposals.
- **Consequence:** Risk percentiles and buffer times are computed analytically without Monte Carlo sampling overhead during real-time dispatch generation.

---

### ADR-24: Request-Scoped Hazard Zones and Audit Explainability

- **Date:** 2026-11-01
- **Decision:** Pass polygon hazard zones as request-scoped parameters (`blockedZones`) in the `POST /assignments/propose` payload rather than managing them via global database entity CRUD. Store the validated input and its SHA-256 canonical JSON hash (`hazardZonesHash`) in the `ASSIGNMENT_PROPOSED` audit log. Frozen committed stops are never rerouted; newly overlapping zones emit warnings.
- **Context:** Disaster hazards evolve rapidly from minute to minute. Dispatchers test hypothetical scenarios ("what if bridge X is washed out?") without altering the shared operational environment for other dispatchers. Storing the full hazard input and its deterministic hash in audit logs ensures that any generated plan can be audited, explained, and reproduced exactly as proposed.
- **Alternatives considered:**
  - _Persistent global HazardZone database entity with CRUD_: Store zones in a database table with CRUD endpoints. Rejected for Phase 4 to avoid state synchronization conflicts across concurrent dispatch simulations and because persistent zone lifecycle management is slated for subsequent phases.
  - _Ephemeral session state_: Store zones in a cache with a session token. Rejected due to added server statefulness and inability to reconstruct historical audit decisions easily.
- **Consequence:** Operators gain flexible "what-if" hazard simulation capabilities while maintaining audit fidelity and reproducible decision records.

---

### ADR-25: 500-Point Matrix Limit for OSRM Prefetching

- **Date:** 2026-11-01
- **Decision:** Bound the prefetch input to a maximum of 500 distinct coordinates (`maxTableCoordinates = 500`) in `prepareTravelTimeProvider`. If a scenario exceeds 500 points (such as the Large benchmark suite), log a warning and fall back entirely to `StraightLineTravelTimeProvider`.
- **Context:** Standard OSRM instances exhibit quadratic latency and memory consumption when computing large distance tables (O(N^2) distance computations). Chunking a 500+ coordinate scenario into 100 x 100 tables requires dozens of sequential HTTP requests, stalling dispatch generation for dozens of seconds and risking request timeouts. Bounding prefetch ensures bounded API latency.
- **Alternatives considered:**
  - _Unbounded chunking with parallel requests_: Dispatch all sub-matrix chunks in parallel. Rejected because concurrent table queries overwhelm self-hosted OSRM instances and trigger HTTP 429 rate limiting on public servers.
  - _Hard 400 rejection_: Reject requests with > 500 points. Rejected because emergency relief systems must gracefully degrade to straight-line heuristics rather than outright failing during large-scale regional disasters.
- **Consequence:** Large-scale scenarios execute reliably without hanging API gateways or exhausting OSRM container memory, providing bounded API latency.

---

### ADR-26: Deterministic Perturbation Noise Model for Route Robustness

- **Date:** 2026-11-01
- **Decision:** Model scenario perturbations using uniform multiplicative noise in [1 - m, 1 + m] generated deterministically per `(seed, from, to)` coordinate pair. Evaluate algorithm stability by measuring route churn (whether a vehicle's ordered pickup list changes) and sequence churn (whether a request's immediate predecessor changes) across noise draws.
- **Context:** Travel times in flood emergencies fluctuate. Evaluating whether dispatch algorithms produce wildly divergent fleet routes under small travel-time noise is critical for field stability. Deterministic PRNG seeding ensures perturbation experiments are strictly reproducible across machines and benchmark runs.
- **Alternatives considered:**
  - _Non-deterministic runtime jitter_: Add random noise using `Math.random()`. Rejected because benchmark results cannot be independently reproduced, verified, or compared across solver commits.
  - _Node-level perturbation only_: Jitter request locations or urgency scores rather than edge travel times. Rejected because road network inundation primarily affects transit duration between fixed physical rescue points.
- **Consequence:** Solver resilience under real-world transit noise can be quantified, compared, and reproduced deterministically across CI and evaluation environments.

---

### ADR-27: Transactional Operational Events over External Message Queues

- **Date:** 2026-11-02
- **Decision:** Persist operational events in PostgreSQL table `operational_events` atomically in the same database transaction client as domain state mutations (requests, resource status changes, road hazard zones). Avoid external message brokers (such as Redis/BullMQ, RabbitMQ, or Kafka) during Phase 5 Part 1.
- **Context:** Disaster relief state mutations require absolute ACID consistency. Writing domain entities to PostgreSQL while publishing events to an external broker risks dual-write anomalies (e.g. request saved in DB but event lost due to network timeout, or event published but DB transaction aborted). An emergency dispatch platform's write throughput (tens to hundreds of operational events per second) is easily handled with high durability by PostgreSQL indexed tables and row-level locking.
- **Alternatives considered:**
  - _Redis / BullMQ queue_: Add BullMQ queue immediately. Rejected for Part 1 to eliminate dual-write hazards and operational dependencies until solver benchmarking proves async background execution is necessary.
  - _Node.js EventEmitter in-memory_: Emit events via Node EventEmitter. Rejected because events are lost if the server process restarts or encounters an unhandled exception.
- **Consequence:** Zero dual-write failures. Domain mutations, operational events, and audit logs succeed or fail together atomically. Event retry and replay are guaranteed without external queue dependencies.

---

### ADR-28: Centralized Role-Based Access Control (RBAC) and Audit Redaction

- **Date:** 2026-11-02
- **Decision:** Define a centralized permission matrix across the three existing operator roles (`OPERATOR`, `DISPATCHER`, `ADMIN`) mapped to specific operational actions (`VIEW_EVENTS`, `VIEW_AUDIT`, `MANAGE_RESOURCE_STATUS`, `MANAGE_BLOCKED_ZONES`, `REQUEST_REPAIR`, `COMMIT_ASSIGNMENT`, `MANAGE_OPERATORS`). Enforce permissions centrally using Express `requirePermission(...)` middleware, and apply automatic field-level redaction (e.g. client IP addresses, internal hashes) when the `OPERATOR` role queries audit logs.
- **Context:** Phase 3 established session authentication and basic role assignment, but operational mutations in Phase 5 (taking vehicles offline, declaring road blockages, triggering replanning) require strict least-privilege enforcement. Only `DISPATCHER` and `ADMIN` should perform operational mutations, while read-only `OPERATOR` roles should inspect events and audit records without viewing sensitive metadata.
- **Alternatives considered:**
  - _Ad-hoc role checks in route handlers_: Duplicate `if (req.operator.role !== ...)` across routes. Rejected due to drift and maintenance hazards.
  - _Full external authorization engine (e.g. OPA/Casbin)_: Rejected as disproportionately complex for a 3-role disaster response hierarchy.
- **Consequence:** Clean, auditable security enforcement across all operational routes with automatic sensitive data redaction.

---

### ADR-29: Solver Repair Interface Boundary and Explicit 503 Signaling

- **Date:** 2026-11-02
- **Decision:** Decouple backend operational event infrastructure from solver repair algorithms via shared contracts (`RepairInput`, `RepairResult`) and a dependency-injected `RepairOrchestrationService`. In Phase 5 Part 1, when no repair solver is plugged in, invoking `POST /operations/repair` explicitly throws HTTP 503 `REPAIR_ENGINE_UNAVAILABLE` rather than returning simulated or dummy success.
- **Context:** Phase 5 is partitioned into Part 1 (Backend Infrastructure, Operational Events, Authorization, and Audit) and Part 2 (Solver Incremental Repair Algorithms). Backend contracts must be established, tested, and validated against OpenAPI without fabricating false solver results or coupling the database directly to optimization algorithms.
- **Alternatives considered:**
  - _Return fake proposed plan in Part 1_: Return a static mock plan to simulate a working solver. Rejected because returning false success violates the project principle of honest status reporting and risks misleading operators.
  - _Omit the repair route entirely until Part 2_: Rejected because Part 1 requires stable backend API contracts for frontend and orchestration integration.
- **Consequence:** The interface boundary for Part 2 is strictly defined and verified, with unambiguous error signaling until the repair solver is integrated.

---

### ADR-30: Deterministic Best-Feasible Insertion Heuristic for Incremental Requests

- **Date:** 2026-11-04
- **Decision:** Implement incremental new-request insertion as a deterministic best-feasible scan across all mutable insertion positions in existing routes. Tie-breaking is fully ordered: (1) `objectiveScore` descending (urgency x route cost x capacity fit), (2) incremental distance cost ascending, (3) `resourceId` lexicographic ascending, (4) pickup index ascending, (5) dropoff index ascending, (6) `shelterId` lexicographic ascending. A new-route activation incurs a fixed 15-minute penalty to prefer insertion into existing routes. Complexity: O(R x L^2 x C) where R = resources, L = route length, C = candidate shelter count.
- **Context:** When a new rescue request arrives during active operations, a full re-solve is prohibitively expensive and disrupts already-committed allocations. A deterministic insertion heuristic that reuses existing routes avoids unnecessary plan churn while giving a reproducible, explainable assignment decision.
- **Alternatives considered:**
  - _Random insertion_: Rejected -- non-deterministic; cannot reproduce benchmark results or audit assignments.
  - _Full re-solve on every event_: Rejected -- O(N^2 log N) solver re-run on every event destroys existing committed plans and creates unacceptable operator workload.
  - _Nearest-neighbor only_: Rejected -- does not minimise churn; may replace good existing assignments unnecessarily.
- **Consequence:** New requests are insertable in bounded time with deterministic tie-breaking; the benchmark confirms event-triggered local repair achieves equal or lower churn compared to full re-solve at a fraction of the latency.

---

### ADR-31: Frozen Stop Protection Invariant in Solver Layer

- **Date:** 2026-11-04
- **Decision:** Any candidate repaired plan that alters, removes, reassigns, or renumbers a stop marked `isFrozen: true` (committed stops) is immediately rejected with status `NO_FEASIBLE_REPAIR`. This invariant is enforced by `validateFrozenStopsPreserved()` in `incremental/frozenStops.ts`, called unconditionally by the orchestrator before accepting any repaired plan. DEPOT stops are excluded from frozen-stop tracking in the churn metric only. Only PICKUP and DROPOFF stops bearing `isFrozen: true` constitute committed rescue assignments and are protected.
- **Context:** Operators manually review and commit specific rescue assignments before resources are dispatched. Automatically overwriting a committed assignment mid-operation would cause field confusion and potentially strand survivors.
- **Alternatives considered:**
  - _Soft warning only_: Rejected -- a warning that can be silently ignored provides no safety guarantee.
  - _Freeze entire routes_: Rejected -- prevents any downstream mutable insertion after a partial commitment, reducing repair opportunity unnecessarily.
- **Consequence:** Committed rescue dispatch decisions are guaranteed to persist across all incremental repair operations. Conflicts surface explicitly as `NO_FEASIBLE_REPAIR` with descriptive warnings.

---

### ADR-32: Assignment Churn Metric Definition

- **Date:** 2026-11-04
- **Decision:** Define the incremental churn rate as (reassignedRequestsCount + newlyUnservedRequestsCount) / comparableExistingAssignments where the denominator is the count of distinct requests served in the baseline plan only. New requests introduced by a REQUEST_CREATED event are excluded from the denominator. When comparableExistingAssignments === 0, the rate is defined as 0.0. Frozen-stop violations exclude: (a) DEPOT stops, and (b) frozen stops from resources that have gone offline (route absent from updated plan).
- **Context:** The churn metric drives strategy comparison in the benchmark harness and in operator-facing repair proposals. A poorly defined denominator would make strategy comparisons meaningless.
- **Alternatives considered:**
  - _Total requests in updated plan as denominator_: Rejected -- includes new requests and masks the actual reassignment rate.
  - _Count all frozen violations regardless of resource status_: Rejected -- a resource going offline legitimately empties its route.
- **Consequence:** The churn metric is comparable across strategy runs, seeds, and event types. The benchmark invariant `frozenViolationsTotal === 0` holds for all three strategies.

---

### ADR-33: Part 2 Solver to Part 1 Backend Integration via RepairSolver Adapter

- **Date:** 2026-11-05
- **Decision:** Phase 5 Part 2 solver algorithms are integrated with the Part 1 backend through a `RepairSolver` adapter implementing the `RepairSolver` interface defined in `@floodrelay/shared`. The adapter maps `RepairInput` to the solver's internal `IncrementalRepairInput`, invokes `repairIncrementally()`, and maps the result back to `RepairResult`. The adapter is registered in the Express app's dependency injection, replacing the 503 `REPAIR_ENGINE_UNAVAILABLE` stub. Pure solver code in `packages/solver` retains zero Express/PostgreSQL dependencies.
- **Context:** Part 1 (PR #22, merged) established `RepairOrchestrationService` with dependency-injected `RepairSolver` and 503 signaling when no solver was registered. Part 2 implements the actual incremental repair algorithms. The adapter bridges these two layers.
- **Alternatives considered:**
  - _Direct solver call from route handler_: Rejected -- bypasses orchestration service authorization and audit responsibilities.
  - _Solver owns its own persistence_: Rejected -- violates separation of concerns; would introduce SQL into the solver library.
- **Consequence:** The repair endpoint produces real incremental solver proposals, persisted as PROPOSED records, while maintaining the Part 1 authorization and audit pipeline.

---

### ADR-34: Shared Live Polling Lifecycle with Page Visibility API and Bounded Exponential Backoff

- **Date:** 2026-11-05
- **Decision:** Implement a centralized React polling hook (`useLivePolling`) using mutable refs (`optionsRef`, `statusRef`, `dataRef`, `isMountedRef`) and stable polling callbacks decoupled from internal polling status transitions. The lifecycle pauses polling on hidden tabs via the Page Visibility API, triggers a single refresh on foreground resume, uses bounded exponential backoff on transient errors (capped at 60s), terminates polling on HTTP 401/403 authorization failures, and preserves the last valid data during transient network errors.
- **Context:** Frequent timer recreation and callback churn occurred when polling status was included in `useEffect` dependency arrays, causing unintentional restarts and overlapping in-flight HTTP requests.
- **Alternatives considered:**
  - _React Query or SWR library_: Rejected to maintain zero unvetted external dependencies and keep frontend bundle lightweight.
  - _Native setInterval with raw fetch_: Rejected due to lack of cancellation on unmount, missing tab visibility pausing, and inability to handle exponential backoff safely.
- **Consequence:** Stable, resource-efficient polling lifecycle across all operator dashboard, map, and event feed screens with cancellation safety and no memory leaks.

---

### ADR-35: Human-in-the-Loop Plan Repair Evaluation and Stability Churn Visualization

- **Date:** 2026-11-05
- **Decision:** Display comprehensive side-by-side plan comparisons between baseline assignments and proposed solver repairs, including overall churn percentage gauge, categorized stop status badges (FROZEN, ADDED, REMOVED, REASSIGNED, REORDERED, UNCHANGED), wait time and SLA impact deltas, and explicit warnings for unserved demand. Commitment requires dispatcher or admin authorization, manual review of frozen stops, and displays an explicit decision-support-only legal disclaimer.
- **Context:** Automated re-optimization during disaster response risks operational chaos if vehicle crews are reassigned arbitrarily. Field supervisors must understand exactly what changes before confirming a plan.
- **Alternatives considered:**
  - _Automated background commitment without operator confirmation_: Rejected as dangerous in live flood environments where field conditions may deviate from solver inputs.
  - _Text-only diff view_: Rejected because spatial and passenger capacity impacts cannot be visually evaluated without structured metrics and route stop diffs.
- **Consequence:** Transparent decision support enabling dispatchers to weigh optimization gains against real-world disruption before committing revised routes.

---

### ADR-36: Isolated Deterministic Test Fixtures and Safe HTTP 503 Solver Fallback

- **Date:** 2026-11-05
- **Decision:** When the Phase 5 Part 2 incremental solver is unavailable (HTTP 503), the frontend surfaces a clear status banner and provides an isolated preview fixture (`SIMULATED_REPAIR_RESULT`) for UI validation. The fixture is strictly locked to prevent database commitments, and real operational data in the database remains unaltered.
- **Context:** Part 3 frontend is being developed in parallel with Part 2 solver algorithms. The UI must be fully verifiable and testable without fabricating backend success or mocking database persistence.
- **Alternatives considered:**
  - _Mock solver responses inside backend API routes_: Rejected because Part 1 requires honest 503 signaling when no solver engine is registered.
  - _Disable repair comparison UI entirely until Part 2 merges_: Rejected because frontend acceptance and UX validation must proceed in parallel.
- **Consequence:** Frontend repair comparison is fully verified and documented while strictly preventing fake plan commits from mutating production or development databases.

---

### ADR-37: Authoritative Resource Inventory and GIS Layer Isolation with Endpoint Disclosure

- **Date:** 2026-11-05
- **Decision:** Visibly segregate real operational telemetry from reference/simulated models across the dashboard and GIS tactical map. Label the staged Harris County fleet as `[SIMULATED / REFERENCE]`, disclose that authoritative resource listing (`GET /operations/resources`) is pending backend implementation, block status mutations against simulated IDs, and provide an authentic database UUID override form for dispatchers. On the map, replace realtime claims with `LIVE INCIDENTS • REFERENCE FLEET & HAZARDS`, and require deliberate coordinate validation and hazard perimeter disclaimers on road blockage creation.
- **Context:** The backend provides `PATCH /operations/resources/:id/status` but currently lacks a resource listing endpoint. Displaying simulated fleet counts as verified live availability would mislead field operations.
- **Alternatives considered:**
  - _Create a mock GET /operations/resources endpoint in API_: Rejected because Part 3 is strictly a frontend implementation; creating fake endpoints violates architectural boundaries.
  - _Hide fleet information completely_: Rejected because dispatchers still need reference fleet specs and the capability to override authentic vehicle statuses by ID.
- **Consequence:** 100% truthful data representation across the entire frontend with no fabricated operational activity and robust guardrails against database corruption.

---

### ADR-38: Duplicate Flag Triage Safety Policy

- **Date:** 2026-11-06
- **Decision:** When a `REQUEST_FLAGGED_DUPLICATE` event occurs, the system preserves all existing mutable and committed stops intact. The incremental repair adapter returns status `NO_FEASIBLE_REPAIR` with an explicit human triage warning, requiring an authorized dispatcher to confirm whether the request is genuinely duplicate or a distinct distress call. No rescue requests or route stops are cancelled automatically.
- **Context:** An automated or crowd-sourced duplicate flag is a triage indicator, not an authorized cancellation. In emergency rescue operations, automatically dropping or cancelling a request on a duplicate flag could abandon real flood victims if the flag was mistaken or inaccurate.
- **Alternatives considered:**
  - _Automatically treat duplicate flag as request cancellation_: Rejected -- catastrophic safety hazard; would strip assigned rescue vehicles from citizens in distress without human authorization.
  - _Silently ignore the event_: Rejected -- fails to inform operators that human triage is required.
- **Consequence:** Zero accidental drop of real rescue requests. Audit events and operator warnings explicitly record that human review is required before any cancellation can be authorized.

---

### ADR-39: Hazard-Aware Travel-Time Routing in Incremental Repair

- **Date:** 2026-11-06
- **Decision:** Incremental repair operations must use the asynchronous hazard-aware road network travel-time provider (`prepareTravelTimeProvider`) constructed from active PostgreSQL blocked zones and OSRM configurations, rather than defaulting unconditionally to straight-line Euclidean distance. When OSRM is unreachable or prefetch thresholds are exceeded, the engine falls back gracefully to `StraightLineTravelTimeProvider` while logging an explicit operational warning.
- **Context:** If incremental repair re-routed vehicles using Euclidean straight-line distance during active floods, proposed routes could traverse flooded road sections or active hazard zones, placing rescue crews and vehicles in danger.
- **Alternatives considered:**
  - _Synchronous Euclidean straight-line only in adapter_: Rejected -- ignores physical road closures and active flood hazards.
  - _Fail hard if OSRM is down_: Rejected -- in a disaster, network partitions happen; falling back with explicit warnings allows life-saving operations to continue.
- **Consequence:** Repaired routes respect active road blockages and flood polygons. System logs warnings whenever fallback estimates are used.

---

### ADR-40: Authoritative Baseline Reconstruction and Repair Comparison Contract

- **Date:** 2026-11-06
- **Decision:** When `baselineAssignmentId` is omitted from a repair request, `IncrementalRepairSolverAdapter` queries `getLatestCommittedAssignment()` from PostgreSQL to reconstruct the authoritative operational baseline rather than defaulting to an empty plan. The repair result returned to the client and persisted in PostgreSQL exposes `proposalId`, `proposedPlan`, `unservedRequestIds`, `warnings`, and `churn` (including `reassignedRequestsCount`, `newlyUnservedRequestsCount`, `churnRate`, and `frozenStopsViolated`).
- **Context:** Frontend operators reviewing proposed repairs (Phase 5 Part 3) need an authoritative comparison against the live committed operational plan to visualize route churn and confirm zero frozen-stop violations. An empty baseline would produce 100% false churn and mask changes.
- **Alternatives considered:**
  - _Require baselineAssignmentId in every request_: Rejected -- complicates frontend call sites and breaks when the frontend only tracks the event ID.
  - _Omit churn from API response_: Rejected -- prevents the UI from displaying reassignment churn and safety validation metrics to the dispatcher.
- **Consequence:** Handshakes smoothly with Part 3 Next.js frontend; dispatchers receive complete comparison diffs with authoritative baseline data.

---

### ADR-41: River Discharge Forecast Context Layer (Informational Only)

- **Date:** 2026-11-08 (Updated: 2026-11-09)
- **Decision:** Integrate an optional river discharge flood context layer sourced from European Centre for Medium-Range Weather Forecasts (ECMWF) Copernicus GloFAS 4.0 gridded river discharge model via Open-Meteo Flood API (CC BY 4.0) for the Delhi Yamuna reach (Lat 28.65, Lng 77.23). The layer is exposed via `GET /forecast/context` with `VIEW_FORECAST` permission and surfaced as an optional toggleable map overlay on the Tactical Leaflet Map. Crucially, the forecast data is informational only: it MUST NOT alter rescue request urgencies, mutate road blockages, reassign resources, or trigger autonomous dispatch. Discharge thresholds (50, 200, 800 m³/s) are heuristic model indicators, not official Central Water Commission (CWC) public flood warnings (which measure physical gauge height in meters above MSL: Warning 204.5 m, Danger 205.33 m). Confidence score is uncalibrated against gauge ground-truth and omitted from production responses. When upstream APIs fail, the service returns cached data with `freshness: 'STALE'` or explicit `freshness: 'UNAVAILABLE'` without fabricating low-risk values. Deterministic offline synthetic fixtures are permitted ONLY when explicitly authorized via `FORECAST_ENABLE_OFFLINE_FIXTURE=1` and are prominently labeled `SIMULATED FORECAST — DEMO ONLY`.
- **Context:** Emergency operations centers benefit from catchment-scale river discharge trend awareness when deploying watercraft along floodplain corridors. However, global hydrological models do not measure localized urban flash inundation or physical gauge heights at Old Railway Bridge; treating catchment discharge as ground-truth water levels or using it to mutate operational plans autonomously would introduce critical safety hazards.
- **Alternatives considered:**
  - _Autonomous urgency escalation based on river discharge forecasts_: Rejected -- catastrophic risk of false evacuations or delayed critical rescues based on coarse gridded estimates.
  - _Gauge-level web scraping of Delhi Central Water Commission gauges_: Rejected -- brittle, unauthorized, and lacks public REST API SLAs compared to Copernicus GloFAS open data.
  - _Silent synthetic fallback on network failure_: Rejected -- misleads dispatchers into believing real-time conditions are normal during internet outages.
  - _Omit hydrological context entirely_: Rejected -- dispatchers requested upstream trend context to anticipate surge windows.
- **Consequence:** Dispatchers gain 7-day river discharge trend intelligence without endangering life-safety operational decisions.

---

### ADR-42: Asynchronous Queue Evaluation & Deferral of Redis/BullMQ

- **Date:** 2026-11-08 (Updated: 2026-11-09)
- **Decision:** Defer the introduction of Redis and BullMQ. Continue utilizing PostgreSQL ACID operational outbox and synchronous solver proposal orchestration for event-driven replanning.
- **Context:** Phase 6 roadmap tasked the team with evaluating whether Redis/BullMQ background queueing is technically required for FloodRelay. Empirical benchmarks across Small (20 requests), Medium (100 requests), and Large (500 requests) operational disaster scales revealed:
  1. Pure in-process incremental solver repair p95 latency is between 0.14 ms and 1.04 ms (max 2.68 ms). (Note: this measures algorithmic repair execution; external OSRM road graph calls and database network round-trips are separate operational dimensions).
  2. Node.js event-loop lag during active repair execution maintains a p90 of 16.1 ms and p99 of 20.9 ms, well below the 50 ms human-perceptible threshold.
  3. Under Grafana k6 HTTP load testing (30 concurrent VUs, 69.56 req/sec), zero requests failed (0.00% failure rate) and p50 latency was 11.28 ms.
  4. Operational decision-support requires human-in-the-loop review: dispatchers interactively request a repair and inspect the proposed diff. Introducing an asynchronous background worker pool would force polling or WebSocket synchronization without saving computational time, while introducing distributed dual-write inconsistency risks between PostgreSQL transactions and Redis queues during life-critical disaster operations.
- **Alternatives considered:**
  - _Introduce Redis + BullMQ unconditionally_: Rejected -- introduces distributed dual-write failure modes during network partitions, extra daemon maintenance in field deployments, and unnecessary architectural complexity when in-process repair execution is < 3 ms.
  - _Worker Threads pool for solver execution_: Evaluated -- feasible if scenario sizes grow to > 5,000 requests, but premature for urban flood rescue sectors (typically 50-500 active incidents per basin sector).
- **Re-evaluation Triggers:**
  Reconsider Redis/BullMQ or worker thread pools if:
  1. Sector incident volume exceeds 5,000 concurrent requests.
  2. Solver execution latency exceeds 500 ms (e.g. multi-depot mixed integer programming).
  3. Event loop lag exceeds 100 ms under sustained load.
- **Consequence:** The platform remains lean, robust, and single-database backed with full transactional consistency and zero external queue dependencies. Concrete empirical evidence is recorded in `docs/performance/redis-queue-evaluation.md` and benchmarkable via `npm run test` and `npx tsx tools/benchmarkQueueNeed.ts`.
