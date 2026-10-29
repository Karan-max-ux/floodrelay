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
  - `ASSUMED_FLOOD_IMPEDANCE_MULTIPLIER` (1.5): Travel impedance multiplier applied when routing through flooded or degraded zones (placeholder, not measured).
  - `ASSUMED_BOAT_SPEED_MIN_KMH` (20 km/h) and `ASSUMED_BOAT_SPEED_MAX_KMH` (30 km/h): Synthetic speed range for boat resources in scenario generator (placeholder, not measured).
  - `ASSUMED_TRUCK_SPEED_MIN_KMH` (35 km/h) and `ASSUMED_TRUCK_SPEED_MAX_KMH` (50 km/h): Synthetic speed range for high-water truck resources in scenario generator (placeholder, not measured).

- **Baseline trade-offs and travel time characteristics:**
  In synthetic benchmark evaluations, relative travel time between Nearest-First (Greedy) and Urgency-batched savings + 2-opt varies with scenario scale: in the Large suite, Nearest-First exhibits lower total travel time than Urgency-batched savings + 2-opt, whereas in Small and Medium suites it does not. Both baselines calculate travel time identically (geodesic distance with detour factor, intermediate shelter drop-offs upon reaching vehicle capacity). This difference is an inherent algorithmic trade-off, not a calculation bug:
  - Nearest-First is designed to minimize immediate step distance and ignores request urgency, forming hyper-local tours intended to achieve low travel duration at the expense of higher wait times for critical requests.
  - Urgency-batched savings + 2-opt: each vehicle's batch is chosen by urgency across the whole map, savings are computed against the primary shelter only (shelters[0]), and 2-opt runs inside the batch; this is not a full textbook Clarke-Wright and its batch selection ignores geography. Because candidates are prioritized by urgency descending before building savings routes, in large scenarios vehicles spend more operational shift time traveling between distant high-urgency incidents.
  - Cluster-Allocation balances spatial compactness with triage priority via DBSCAN clustering, achieving lower high-priority wait times while maintaining full coverage.
  - For current benchmark numbers across scenario scales, run `npx tsx scenarios/evaluate.ts`.

- **Solver coverage under shift duration constraints:**
  In dense scenarios, Urgency-batched savings + 2-opt may leave requests unserved. Investigation shows passenger group sizes are well within vehicle capacity, but individual vehicles exhaust their per-vehicle shift limit (`maxShiftMinutes`, default 480 minutes per vehicle; this refers to the operational limit for each individual vehicle, not a combined fleet-wide time budget) when trip candidates are selected by urgency across the entire map rather than by geographic proximity, spending significant vehicle shift time in transit between dispersed incidents. When an individual vehicle's shift limit expires before reaching remaining peripheral or lower-priority requests, those requests cannot be assigned if no other vehicle has remaining shift capacity. Previously, solvers checked only the transit time to a pickup before committing it, allowing the subsequent return leg to a shelter to cause per-vehicle shift overruns. The system now strictly enforces that both transit to the pickup and the return leg to the nearest shelter must fit within the per-vehicle shift limit before any pickup is committed. Under strict shift enforcement, all routes remain strictly within each vehicle's shift limit, and unserved demand under shift exhaustion is marked `SHIFT_LIMIT_REACHED`, distinguishing it from groups that exceed fleet vehicle capacity (`GROUP_LARGER_THAN_ANY_VEHICLE`). In contrast, it is hypothesized that solvers that group demand into spatial clusters reduce transit overhead between incidents, which may help avoid premature per-vehicle shift exhaustion, though this specific causal mechanism remains an explanatory hypothesis rather than an experimentally isolated finding.

- **TODO:** A real Google OR-Tools baseline is not implemented. The current algorithmic baselines are Nearest-First (Greedy) and Urgency-batched savings + 2-opt (Clarke-Wright savings heuristic variant).
