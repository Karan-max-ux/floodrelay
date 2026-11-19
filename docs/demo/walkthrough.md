# FloodRelay — 8-Step End-to-End Walkthrough Guide

This document guides evaluators, faculty members, and engineers through the complete 8-step disaster response lifecycle in FloodRelay.

---

## Step 1: Public Citizen Distress Submission

### Objective

Demonstrate public intake of urgent citizen rescue requests with validation, coordinates, and idempotency guarantees.

### User Actions

1. Open [http://localhost:3000/citizen/request](http://localhost:3000/citizen/request).
2. Enter the distress report:
   - **Location:** Lat `28.665`, Lng `77.228` (Terrace near Kashmere Gate).
   - **People Count:** `4`.
   - **Urgency:** `CRITICAL`.
   - **Medical Needs:** Checked (Insulin required for elderly resident).
   - **Notes:** `"Water level reaching 1st floor; 2 elderly adults and 2 children stranded."`
3. Click **Submit Distress Call**.
4. Note the generated tracking identifier (e.g., `req-...`).

### Behind the Scenes

- The Express API validates input against `CreateRequestSchema` (Zod).
- Coordinates are converted to PostGIS `GEOGRAPHY(Point, 4326)`.
- Request status initializes to `PENDING`, `verification_status: UNVERIFIED`.
- Spatial duplicate detection runs within a 100-meter radius.

---

## Step 2: Operator Request Monitoring & Duplicate Triage

### Objective

Show how dispatchers monitor incoming distress calls, filter by urgency, and triage crowd-sourced duplicate reports without silently discarding data.

### User Actions

1. Navigate to [http://localhost:3000/operator](http://localhost:3000/operator).
2. Log in using `demo_operator` and the password from `npm run demo:credentials`.
3. Filter requests by **Urgency: CRITICAL**.
4. Observe `demo-req-002` flagged with a **DUPLICATE** warning badge (submitted ~30 meters from `demo-req-001`).
5. Open request details to inspect both reports. Notice both entries remain intact in the database for human triage rather than being deleted.

### Safety Invariant

> [!IMPORTANT]
> Under FloodRelay triage rules (ADR-38), duplicate flags do NOT delete or cancel rescue requests. Dispatchers retain full human review to verify whether multiple calls represent the same household or adjacent stranded groups.

---

## Step 3: Algorithmic Proposal Generation (Human-in-the-Loop)

### Objective

Demonstrate algorithmic vehicle route generation without autonomous dispatch.

### User Actions

1. On the Operator Portal, navigate to **Assignments** and click **Propose New Plan**.
2. Select algorithm: **Cluster-Allocation** or **Savings Baseline**.
3. Click **Generate Proposal**.
4. Inspect the generated plan:
   - Status: `PROPOSED` (Strictly non-committed).
   - Route assignments across available rescue boats (`demo-res-boat-01`, `demo-res-boat-02`).
   - Predicted arrival times and pickup-dropoff sequences.

### Safety Invariant

> [!NOTE]
> The solver operates as a decision-support advisor. No autonomous dispatch or vehicle mobilization occurs until confirmed by an operator.

---

## Step 4: Operator Commitment & Frozen Mission Stops

### Objective

Demonstrate the human commitment transition and freezing of active mission stops.

### User Actions

1. Review the proposed routes, travel times, and assigned shelters.
2. In the Operator Action panel, add an operational note: `"Authorized initial deployment by duty officer"`.
3. For live operational workflows (or distress calls submitted via the citizen portal in Step 1 which carry `source: 'REPORTED'`), click **Commit Deployment Plan**.
4. Observe the state transition:
   - Assignment status changes to `COMMITTED`.
   - All route stops receive `is_frozen = true`.
   - Associated requests transition to `ASSIGNED`.

### Safety & Provenance Invariants

> [!IMPORTANT]
> **Simulation Preview Mode vs. Operational Commitment (ADR-41):**
> When exploring pre-seeded synthetic demo scenarios (`demo-yamuna-scenario.json`), requests and resources are labeled `source: 'SIMULATED'`. Under FloodRelay operational provenance rules (PR #41), committing synthetic data to operational dispatch is strictly prohibited (`409 SIMULATED_REQUEST_FORBIDDEN` / `SIMULATED_RESOURCE_FORBIDDEN`).
> The demonstration environment runs in **Simulation Preview Mode**, safely holding synthetic baseline proposals in `PROPOSED` status for evaluation and incremental repair testing. Authentic operational commitment is reserved for real citizen intake (`source: 'REPORTED'`) and operational assets (`source: 'REAL'`). Once committed, stops are immutable markers of active in-flight missions (`is_frozen = true`), and subsequent re-plans must preserve them with zero violations.

---

## Step 5: Real-Time Operational Disruption Injection

### Objective

Demonstrate how field incidents (vehicle breakdowns and road closures) are captured as auditable operational events.

### User Actions

1. Open [http://localhost:3000/operator/map](http://localhost:3000/operator/map).
2. In the Resource Panel, select `demo-res-boat-01` and update status to **OFFLINE** with reason: `"Engine flooded during river crossing"`.
3. In the Hazard Panel, draw or register a road blockage over **Ring Road Underpass** (`demo-zone-submerged-bypass`).
4. View the recorded events in the Live Event Stream:
   - Event `RESOURCE_OFFLINE` (Entity: `demo-res-boat-01`)
   - Event `ROAD_BLOCKED` (Entity: `demo-zone-submerged-bypass`)

---

## Step 6: Incremental Plan Repair (Zero Frozen-Stop Violations)

### Objective

Demonstrate real-time incremental re-optimization that repairs disrupted routes while guaranteeing that in-flight rescues remain untouched.

### User Actions

1. On the Operator Portal, select the disruption event (`RESOURCE_OFFLINE`).
2. Click **Request Incremental Repair**.
3. Inspect the repair proposal:
   - Status: `PROPOSED`.
   - **Churn Analysis:**
     - `frozenStopsViolated`: `0` (Committed in-flight missions strictly untouched).
     - `reassignedRequests`: Unfinished pickups from the disabled craft reallocated to available resources.
     - `churnRate`: Minimal path deviation score.
4. Compare baseline vs. repair side-by-side on the tactical map.

---

## Step 7: GIS River Flood Forecast Context Layer

### Objective

Inspect external hydrological forecast context alongside tactical rescue operations.

### User Actions

1. On the Tactical Map ([http://localhost:3000/operator/map](http://localhost:3000/operator/map)), locate the layer controls in the top-right.
2. Toggle the **River Flood Forecast (GloFAS)** layer ON.
3. Observe the cyan river station marker positioned on the Yamuna basin (Lat 28.675, Lng 77.225).
4. Click the station marker or inspect the floating forecast card:
   - 7-day river discharge trend ($m^3/s$).
   - Current discharge and peak forecast.
   - Informational disclaimer explaining that river discharge is catchment-scale and informational only.

---

## Step 8: Operational Audit Trail & Verification

### Objective

Verify the end-to-end auditability and compliance trail.

### User Actions

1. Navigate to [http://localhost:3000/operator/audit](http://localhost:3000/operator/audit).
2. Review the chronological audit log entries:
   - `SCENARIO_LOADED`
   - `REQUEST_CREATED`
   - `ASSIGNMENT_COMMITTED` (with operator notes)
   - `RESOURCE_OFFLINE`
   - `ROAD_BLOCKED`
   - `REPAIR_PROPOSED`
3. Notice that sensitive client IP and internal tokens are properly redacted based on operator role permissions.
