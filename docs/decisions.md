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
- **Context:** Rescue vehicles (inflatable boats, high-water trucks) have finite passenger capacities (typically 6–18 people). In severe flooding events with hundreds of stranded victims, a vehicle cannot execute a continuous tour without offloading evacuees. Routing models must explicitly account for intermediate shelter drop-off trips to guarantee passenger safety and avoid vehicle overloading.
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

### ADR-17: Rejection of Frozen Route Preservation for Greedy and Savings Baselines

- **Date:** 2026-10-29
- **Decision:** Reject attempts to propose assignments using the `nearest-first` or `savings` baseline algorithms with HTTP 400 (`UNSUPPORTED_ALGORITHM_OPTION`) whenever committed frozen stops exist in the active scenario, or when `preserveFrozen: true` is explicitly requested. Operators requiring incremental replanning around committed stops must use `cluster-allocation` or explicitly pass `preserveFrozen: false` to recalculate entirely from scratch.
- **Context:** The Nearest-First greedy heuristic and Clarke-Wright savings baseline construct route networks ab initio and do not model fixed initial partial routes or committed frozen waypoints. Allowing these baseline solvers to run while committed stops exist would either silently ignore the frozen stops (leading to disjoint dispatches and conflicting vehicle assignments) or fail downstream constraints. Explicit rejection provides unambiguous feedback to operators.
- **Alternatives considered:**
  - Silently disregard frozen stops: Rejected because committed rescue units would have their active tasks dropped or reassigned, violating dispatch integrity.
  - Artificially prepend frozen stops to baseline routes without re-optimizing: Rejected because greedy and savings heuristics cannot guarantee capacity or shift limit compliance when prepended with arbitrary prior routes.
- **Consequence:** Clear algorithm capability contracts: `cluster-allocation` supports incremental operations with frozen stops; `nearest-first` and `savings` serve as pure initial baselines.

---

### ADR-18: Deterministic resource-level locking and transactional rollback verification

- **Date:** 2026-10-30
- **Decision:** In `commitAssignment()`, acquire exclusive PostgreSQL row locks (`SELECT ... FOR UPDATE`) on the assignment row, all referenced request rows (in ascending ID order), and all referenced resource rows (in ascending ID order) within a single database transaction. Recheck for resource assignment conflicts after locks are acquired before applying status transitions. Wrap the entire workflow—assignment status update, stop freezing, request assignment, and audit event insertion—in a PostgreSQL transaction that performs full rollback on any intermediate failure.
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
