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
  - `ASSUMED_DETOUR_FACTOR` (1.3): Alias for `ASSUMED_ROAD_DETOUR_FACTOR` (placeholder, not measured).
  - `ASSUMED_DEFAULT_SPEED_KMH` (30 km/h): Fallback speed for travel time estimation when resource speed is not specified (placeholder, not measured).
  - `ASSUMED_FLOOD_IMPEDANCE_MULTIPLIER` (1.5): Travel impedance multiplier applied when routing through flooded or degraded zones (placeholder, not measured).
  - `ASSUMED_BOAT_SPEED_MIN_KMH` (20 km/h) and `ASSUMED_BOAT_SPEED_MAX_KMH` (30 km/h): Synthetic speed range for boat resources in scenario generator (placeholder, not measured).
  - `ASSUMED_TRUCK_SPEED_MIN_KMH` (35 km/h) and `ASSUMED_TRUCK_SPEED_MAX_KMH` (50 km/h): Synthetic speed range for high-water truck resources in scenario generator (placeholder, not measured).

- **Baseline trade-offs and travel time characteristics:**
  In synthetic benchmark evaluations, Nearest-First (Greedy) exhibits lower total travel time than Clarke-Wright + 2-opt. Both baselines calculate travel time identically (geodesic distance with detour factor, intermediate shelter drop-offs upon reaching vehicle capacity). This difference is an inherent algorithmic trade-off, not a calculation bug:
  - Nearest-First purely minimizes immediate step distance and ignores request urgency, forming hyper-local tours with low travel duration at the expense of higher wait times for critical requests.
  - Clarke-Wright + 2-opt selects trip candidates prioritized by urgency descending before building savings routes, requiring longer transit across dispersed high-urgency incidents.
  - Cluster-Allocation balances spatial compactness with triage priority via DBSCAN clustering, achieving lower high-priority wait times while maintaining reasonable travel efficiency.
  - For current benchmark numbers, run `npx tsx scenarios/evaluate.ts`.

- **Solver coverage under shift duration constraints:**
  In dense scenarios, Clarke-Wright + 2-opt may occasionally leave a small portion of requests unserved under vehicle capacity and shift duration limits. Because Clarke-Wright selects trip candidates prioritized by urgency across the map rather than by immediate geographic proximity, vehicles spend more operational shift time traveling between distant high-urgency incidents. As a consequence, vehicle shift limits can be exhausted before the fleet finishes serving all remaining low-urgency or peripheral requests. In contrast, solvers that group demand by spatial clusters reduce transit overhead, avoiding premature shift exhaustion.

- **TODO:** A real Google OR-Tools baseline is not implemented. The current algorithmic baselines are Nearest-First (Greedy) and Clarke-Wright (savings + 2-opt).
