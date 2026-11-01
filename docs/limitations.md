# Known Limitations

This file documents honest limitations of the system. Keep it updated as the project grows.

---

- **Demo rescue requests are simulated.** All demo and test requests are generated from seeded scripts and are labelled `SIMULATED`. They do not represent real incidents.

- **OSRM uses static map data.** OSRM does not know which roads are currently flooded. Operators mark blocked areas manually, and routes crossing them are flagged. This means routing may suggest paths through areas that are actually impassable until an operator marks them.

- **No live traffic.** Travel-time estimates do not account for real-time traffic conditions.

- **Results are from simulated scenarios.** All evaluation results are from simulated scenarios across predefined synthetic sizes (Small: 20 req / 4 res, Medium: 100 req / 12 res, Large: 500 req / 30 res) and are not field-validated. They should not be interpreted as guarantees of real-world performance.

- **Routing and speed assumptions (uncalibrated placeholders):**
  Travel times and synthetic scenarios rely on estimated parameters that are not calibrated against empirical disaster-response telemetry:
  - `ASSUMED_ROAD_DETOUR_FACTOR` (1.3): Geodesic haversine distance multiplier to approximate road route tortuosity (placeholder, not measured).
  - `ASSUMED_DEFAULT_SPEED_KMH` (30 km/h): Fallback speed for travel time estimation when resource speed is not specified (placeholder, not measured).
  - `ASSUMED_FLOOD_IMPEDANCE_MULTIPLIER` (1.5): Baseline travel impedance multiplier applied when routing through generic flooded or degraded segments without polygonal zones (placeholder, not measured).
  - `ASSUMED_CAUTION_IMPEDANCE_MULTIPLIER` (1.25): Travel impedance multiplier applied in `HazardAwareTravelTimeProvider` and `legImpedanceMultiplier` when routing across operator-marked `CAUTION` hazard zones (mild water pooling, minor debris; placeholder, not measured). It represents milder degradation than the generic 1.5x flood multiplier.
  - `ASSUMED_WATER_SURGE_IMPEDANCE_MULTIPLIER` (2.0): Travel impedance multiplier applied in `HazardAwareTravelTimeProvider` and `legImpedanceMultiplier` when routing across operator-marked `WATER_SURGE` hazard zones (deep, fast-moving flood waters; placeholder, not measured). It enforces a heavier 2.0x penalty compared to the generic 1.5x flood multiplier.
  - `ASSUMED_BLOCKED_PENALTY_MULTIPLIER` (10.0): Finite penalty multiplier applied to impassable legs crossing `BLOCKED` hazard zones when running under the non-default `PENALTY` policy (placeholder, not measured). Under the default `INFINITE` policy, blocked legs receive Infinite duration/distance.
  - `ASSUMED_MAX_HAZARD_ZONES` (100 zones): Request ceiling on the number of polygon hazard zones accepted per proposal (placeholder, not measured).
  - `ASSUMED_MAX_VERTICES_PER_POLYGON` (200 vertices): Ceiling on the number of boundary vertices per hazard polygon ring (placeholder, not measured).
  - `ASSUMED_MAX_TOTAL_VERTICES_PER_REQUEST` (2000 vertices): Cumulative ceiling on total vertices across all hazard zones in a request (placeholder, not measured).
  - `ASSUMED_BOAT_SPEED_MIN_KMH` (20 km/h) and `ASSUMED_BOAT_SPEED_MAX_KMH` (30 km/h): Synthetic speed range for boat resources in scenario generator (placeholder, not measured).
  - `ASSUMED_TRUCK_SPEED_MIN_KMH` (35 km/h) and `ASSUMED_TRUCK_SPEED_MAX_KMH` (50 km/h): Synthetic speed range for high-water truck resources in scenario generator (placeholder, not measured).

- **Duplicate detection heuristic constants (uncalibrated placeholders):**
  The request intake pipeline applies spatial-temporal proximity heuristics to flag likely duplicate citizen reports without dropping unverified requests:
  - `ASSUMED_DUPLICATE_RADIUS_METERS` (100 meters): Maximum geographic radius threshold to evaluate whether two rescue reports refer to the same physical incident (placeholder, not measured).
  - `ASSUMED_DUPLICATE_TIME_WINDOW_MS` (7,200,000 ms / 2 hours): Temporal time window within which subsequent reports within the duplicate radius are evaluated for duplicate flagging (placeholder, not measured).
  - `ASSUMED_DUPLICATE_PEOPLE_DELTA` (±2 people): Permissible group size delta between reports to accommodate citizen estimation uncertainty while matching duplicates (placeholder, not measured).

- **Security, authentication, and authorization:**
  The platform provides no authentication or authorization; `x-operator-id` is caller-supplied and spoofable, and the API must not be exposed publicly without an authenticating reverse proxy or API gateway enforcing perimeter security.

- **Privacy, communications, and data retention:**
  - **No citizen contact details collected:** The intake schema collects coordinates, group size, urgency, and medical needs, but no contact details are collected so operators cannot call a requester.
  - **PII in free text notes:** `notes` is free text that may contain personal data and has no retention rule or automated redaction policy.

- **Resource-level locking, lock order hierarchy, and concurrency limitations:**
  - **Lock Order Hierarchy:** The platform enforces row-level locking in `commitAssignment()` in a strict three-phase order: first the target assignment row, then all referenced request rows in ascending ID order, and finally all referenced resource rows in ascending ID order (`SELECT id, status FROM resources WHERE id = ANY($1::text[]) ORDER BY id COLLATE "C" ASC FOR UPDATE`). This lock order is verified only within `commitAssignment()` (tested by `prevents two different proposals using the same resource for different requests from committing concurrently via genuine overlapping transactions`). If any other current or future code path acquires these same rows in a differing sequence (e.g. locking resources before requests), PostgreSQL deadlocks can occur under concurrent load.
  - **Lock Contention:** While row-level locking serializes concurrent commits on the same resource, it introduces lock contention under high concurrent commit volume on the same resource fleet.
  - **Collation Scope:** Locking order consistency between PostgreSQL and Node.js (`ORDER BY id COLLATE "C" ASC` vs JavaScript array `.sort()`) is verified only for ASCII string identifiers (tested by `proves identical lock acquisition ordering between JS .sort() and PostgreSQL COLLATE "C" across mixed-case, numbers, and underscores`). Non-ASCII or multi-byte UTF-8 identifiers may diverge between byte-level binary collation and JavaScript locale-aware collation rules.
  - **Residual Concurrency Race in `modifyStop()`:** The `modifyStop()` endpoint (PATCH `/assignments/:id/stops/:stopId`) updates individual stop properties (e.g. `isFrozen`, `resourceId`, `stopNumber`) via auto-committed queries without acquiring an exclusive row lock on the parent assignment. If an operator PATCHes a stop while a concurrent commit operation is evaluating that assignment, a residual concurrency race exists where stop state may be modified immediately before or after commit validation.
  - **Database Scope:** This concurrency model relies on single-database ACID guarantees; in a multi-region or distributed database topology without centralized transaction coordination, distributed locking would be required.

- **Frozen-stop continuation, lineage verification, and lifecycle limitations:**
  - **Bidirectional Lineage Enforcement:** Replanning with frozen stops validates stop continuity through three verification checks before committing: Check 1 rejects frozen stops on a resource without prior commitment; Check 2 requires that every prior committed stop on the resource is preserved as frozen in the plan; Check 3 requires that every frozen stop (`PICKUP` and `DROPOFF`) belongs to the resource's prior committed assignment lineage (tested by negative integration tests for Check 1, Check 2, and Check 3).
  - **Check 1 Redundancy with Check 3:** Check 1 is redundant with Check 3: Check 1 rejects frozen stops on a resource with no prior commitment, serving strictly as defense-in-depth because Check 3 would also reject those stops as not belonging to any prior assignment lineage.
  - **Carry-Forward of All Earlier Stops:** Because Phase 2 does not implement an assignment completion or retirement workflow (e.g. `COMPLETED` or `CANCELLED`), old assignments remain in `COMMITTED` status in the database. Consequently, a replan that drops a prior committed stop is rejected with HTTP 409 `RESOURCE_ALREADY_COMMITTED` by Check 2 until Phase 3 implements an explicit assignment completion, stop fulfillment, or retirement lifecycle (verified by `allows sequential multi-replan chaining across plan 1, plan 2, and plan 3 on the same resource`).
  - **All Stops Frozen Post-Commit:** Upon commitment, `commitAssignment()` executes `UPDATE assignment_stops SET is_frozen = TRUE WHERE assignment_id = $1`, setting `is_frozen = true` on every stop associated with the committed plan.
  - **Strict Request Status for Frozen Pickups:** Frozen pickup stops strictly require referenced requests to be in `ASSIGNED` status (tested by `rejects committing an assignment where a frozen pickup references a request in CANCELLED status` and `rejects committing an assignment where a new non-frozen pickup references an already ASSIGNED request`). Request lifecycle transitions to `IN_TRANSIT` and `RESCUED` are deferred to Phase 3 execution tracking.
  - **Duplicate Pickup Rejection:** A single proposal cannot include duplicate pickup stops referencing the same request ID across different stops or vehicles (tested by `rejects committing an assignment where the same request appears in both a frozen and a non-frozen pickup within one plan`).
  - **Client-Settable `is_frozen`:** Because the API lacks authentication, `is_frozen` can be toggled by operators via PATCH `/assignments/:id/stops/:stopId`. If an operator unfreezes a legitimate prior committed pickup stop, commitment is rejected at the pickup-status step (`REQUEST_ALREADY_ASSIGNED` 409, tested by `rejects committing an assignment at the pickup-status step if an operator unfreezes (isFrozen=false) a legitimate prior committed pickup stop`).
  - **Algorithm Support:** Only `cluster-allocation` supports incremental replanning around frozen stops; baseline algorithms (`nearest-first` and `savings`) reject requests containing committed frozen stops with HTTP 400. Once committed, frozen stops cannot be reshuffled by the solver. If field conditions require aborting a frozen stop (e.g. road becomes impassable), an operator must explicitly modify the stop or cancel the assignment.

- **Transaction rollback verification & error handling:**
  - Atomicity across assignment commitment, stop freezing, request assignment, and audit logging is enforced through PostgreSQL transactions. Live PostGIS integration tests verify that late statement failures (e.g. during audit-event insertion) cause complete rollback of all intermediate writes, leaving assignments in `PROPOSED`, requests in `PENDING`, stops unfrozen, and audit records reverted (tested by `rolls back all database state after partial writes when late audit-event insert fails`).
  - **Connection State Error on Omitted Rollback:** In mutation testing where `BEGIN` was executed but `ROLLBACK` was omitted on error, the failure was caught indirectly as a connection-state error (`25P02: current transaction is aborted, commands ignored until end of transaction block`) when the connection was reused from the pool on subsequent query execution, rather than by a post-error outcome assertion.

- **Simulation provenance, metadata & dynamic region limitations:**
  - **Convention-Based Empty/Unrecognized Classification:** When all entities have null, undefined, or unrecognized `source` values, or when a scenario is empty, `classifyScenarioProvenance` classifies the scenario as `REAL` (`simulated: false`) by platform convention rather than empirical incident evidence. (An architectural alternative would be introducing an explicit `UNKNOWN` provenance enum value).
  - **Omission of `simulated` for MIXED Provenance:** For `MIXED` provenance, `simulated` is set to `undefined`, which standard JSON serialization omits from serialized output. Consumers must inspect `provenance: 'MIXED'` as the authoritative classification (an alternative would be serializing `simulated: null`).
  - **Fixed 8-Box Region Mapping:** Region derivation determines scenario region by calculating the center coordinates across all points and testing against 8 fixed, mutually disjoint bounding boxes (Delhi, Mumbai, Kerala, Assam, Bihar, Chennai, Kolkata, Houston; verified disjoint by unit test in `provenanceRegion.test.ts`). Points outside these boxes receive a generic coordinate-based label (`Operational Area (lat, lng)`). Scenarios with points spanning across multiple regions are assigned a single region label based solely on their spatial centroid.
  - **Derived Bounds vs File Bounds:** Dynamically derived bounds computed from actual entity min/max coordinates are tighter than the broader static bounding box in `sample-scenario.json`, with coordinates clamped within [-90, 90] and [-180, 180]. These bounds are validated by `validateScenario()`, but are not read or enforced by dispatch routing algorithms or API endpoints.

- **Assignment lifecycle state transitions:**
  `DISPATCHED`, `COMPLETED` and `CANCELLED` assignment states exist in the schema and OpenAPI enumeration but have no transitions yet. Currently, only transitions between `PROPOSED` and `COMMITTED` are implemented.

- **Baseline trade-offs and travel time characteristics:**
  In synthetic benchmark evaluations, relative travel time between Nearest-First (Greedy) and Urgency-batched savings + 2-opt varies with scenario scale: in the Large suite, Nearest-First exhibits lower total travel time than Urgency-batched savings + 2-opt, whereas in Small and Medium suites it does not. Both baselines calculate travel time identically (geodesic distance with detour factor, intermediate shelter drop-offs upon reaching vehicle capacity). This difference is an inherent algorithmic trade-off, not a calculation bug:
  - Nearest-First is designed to minimize immediate step distance and ignores request urgency, forming hyper-local tours intended to achieve low travel duration at the expense of higher wait times for critical requests.
  - Urgency-batched savings + 2-opt: each vehicle's batch is chosen by urgency across the whole map, savings are computed against the primary shelter only (shelters[0]), and 2-opt runs inside the batch; this is not a full textbook Clarke-Wright and its batch selection ignores geography. Because candidates are prioritized by urgency descending before building savings routes, in large scenarios vehicles spend more operational shift time traveling between distant high-urgency incidents.
  - Cluster-Allocation balances spatial compactness with triage priority via DBSCAN clustering, achieving lower high-priority wait times while maintaining full coverage.
  - For current benchmark numbers across scenario scales, run `npx tsx scenarios/evaluate.ts`.

- **Solver coverage under shift duration constraints:**
  In dense scenarios, Urgency-batched savings + 2-opt may leave requests unserved. Investigation shows passenger group sizes are well within vehicle capacity, but individual vehicles exhaust their per-vehicle shift limit (`maxShiftMinutes`, default 480 minutes per vehicle; this refers to the operational limit for each individual vehicle, not a combined fleet-wide time budget) when trip candidates are selected by urgency across the entire map rather than by geographic proximity, spending significant vehicle shift time in transit between dispersed incidents. When an individual vehicle's shift limit expires before reaching remaining peripheral or lower-priority requests, those requests cannot be assigned if no other vehicle has remaining shift capacity. Previously, solvers checked only the transit time to a pickup before committing it, allowing the subsequent return leg to a shelter to cause per-vehicle shift overruns. The system now strictly enforces that both transit to the pickup and the return leg to the nearest shelter must fit within the per-vehicle shift limit before any pickup is committed. Under strict shift enforcement, all routes remain strictly within each vehicle's shift limit, and unserved demand under shift exhaustion is marked `SHIFT_LIMIT_REACHED`, distinguishing it from groups that exceed fleet vehicle capacity (`GROUP_LARGER_THAN_ANY_VEHICLE`). In contrast, it is hypothesized that solvers that group demand into spatial clusters reduce transit overhead between incidents, which may help avoid premature per-vehicle shift exhaustion, though this specific causal mechanism remains an explanatory hypothesis rather than an experimentally isolated finding.

- **Google OR-Tools Baseline:** Google OR-Tools is implemented as an external optimization baseline in Python (`tools/ortools-baseline`) and integrated via child-process execution. It formulates rescue operations as a multi-vehicle Pickup and Delivery Problem (PDP) with capacity dimensions and return-leg shift limits. As an optimization baseline utilizing constraint programming and guided local search metaheuristics, its execution duration is bounded by user-configured timeouts and does not guarantee global optimality on general VRP instances under finite search bounds.

- **Integration test verbosity and execution time:**
  The live integration test suite (`integration.test.ts`) contains extensive, fully self-contained end-to-end scenarios against PostgreSQL/PostGIS. Because each test seeds isolated resources, shelters, requests, and assignments to prevent cross-test contamination, the test file comprises approximately 2,960 lines and executes in approximately 1.5–2.5 seconds.

- **OSRM Table API limitations & chunking boundary:**
  - **Static OpenStreetMap data:** OSRM calculates routes and durations across static OpenStreetMap network data and does not dynamically represent real-time inundation or depth without operator-marked zones.
  - **Coordinate request limit & chunking:** Public and standard self-hosted OSRM instances enforce an upper bound on table coordinates (default `maxTableCoordinates = 100` total origins and destinations per HTTP request). `OsrmTravelTimeProvider` decomposes larger matrices into 2D sub-queries via `planChunks` and aggregates them into a unified cache. Because solvers run synchronously, any cache miss, network timeout, or HTTP 429/5xx error falls back to `StraightLineTravelTimeProvider` with statistics recorded in `OsrmStats`.
  - **Local OSRM verification scope:** Live integration testing has been completed against an active local OSRM Docker container (`ghcr.io/project-osrm/osrm-backend:v5.27.1`) using the BBBike New Delhi extract (covering all physical entities in the Delhi NCR Yamuna basin scenario, where actual coordinates reside between lat 28.65–28.705 within extract bounds [28.44, 28.738]). However, production deployment requires provisioning a dedicated OSRM instance covering the complete national or operational geographic theater, ensuring appropriate RAM allocation for MLD multi-level partition hierarchies, and maintaining periodic OSM extract updates. See [docs/osrm.md](osrm.md) for full operational instructions, limitations, and verification steps.

- **Hazard polygon straight-line segment approximation:**
  The hazard evaluation functions (`pointInPolygon`, `segmentIntersectsPolygon`, `HazardAwareTravelTimeProvider`) evaluate straight-line geodesic segments connecting origin and destination coordinates against polygonal hazard zones. Real-world emergency vehicles navigate winding road networks; a physical road might detour around a hazard that the straight line crosses (false positive), or conversely curve through a hazard zone even if the Euclidean segment endpoints avoid it (false negative). Dynamic polygon avoidance within the road network requires edge-weight updates directly on the routing graph.

- **Request-scoped hazard zones and frozen stop preservation:**
  - **No entity persistence / No zone CRUD:** Hazard zones are supplied per-proposal as request-scoped parameters (`blockedZones`). They are not persisted as database entities, and there is no standalone Zone CRUD API (e.g. `POST /zones`).
  - **Plan explainability and audit hashing:** To ensure dispatch decisions remain auditable and reproducible, the `ASSIGNMENT_PROPOSED` audit log records the validated `hazardZones` input and its SHA-256 canonical JSON hash (`hazardZonesHash`).
  - **Frozen committed stops invariant:** Committed stops marked frozen (`is_frozen = true`) represent active rescue missions and are never rerouted or cancelled by subsequent proposals. If a newly introduced hazard zone intersects a frozen leg, the route is preserved as-is and a warning is emitted in `travelTime.warnings`.

- **Google OR-Tools Python solver isolation:**
  The Google OR-Tools baseline runs in an independent Python subprocess (`tools/ortools-baseline/solver.py`) with internal distance calculations. It does not interface with TypeScript `TravelTimeProvider` implementations, meaning it cannot participate in `HazardAwareTravelTimeProvider`, `RiskAwareTravelTimeProvider`, or automated perturbation studies without reimplementing custom distance providers in Python.

- **Lognormal travel time uncertainty calibration (uncalibrated placeholders):**
  The effective coefficient of variation (CV = sigma / mean) is computed by combining individual uncertainty factors in quadrature:
  cv_effective = sqrt(cv_base^2 + cv_depth^2 + cv_weather^2 + cv_congestion^2 + cv_hazard^2)
  where:
  - cv_base = ASSUMED_BASE_CV (0.15, placeholder, not measured)
  - cv_depth = waterDepthMeters * ASSUMED_WATER_DEPTH_CV_FACTOR (0.20 per meter, placeholder, not measured)
  - cv_weather = weatherSeverity * ASSUMED_WEATHER_CV_FACTOR (0.10 per severity level 0-3, placeholder, not measured)
  - cv_congestion = congestionFactor * ASSUMED_CONGESTION_CV_FACTOR (0.15, placeholder, not measured)
  - cv_hazard = ASSUMED_HAZARD_CV_WATER_SURGE (0.30 for WATER_SURGE or BLOCKED, placeholder, not measured)
    | ASSUMED_HAZARD_CV_CAUTION (0.15 for CAUTION, placeholder, not measured)
    | 0.0 (otherwise)
    All terms represent heuristic uncalibrated estimates without empirical telemetry calibration. Travel times follow a lognormal distribution parameterized by planned duration and cv_effective. The inverse normal CDF uses Peter J. Acklam's rational approximation algorithm with a relative error of about 1.15e-9.
