# OSRM Road Network Integration & Routing Guide

This document describes how to configure, run, and verify the Open Source Routing Machine (OSRM) integration for FloodRelay.

> [!NOTE]
> **Environment Verification Notice:**
> The OSRM Docker services (`infra/docker-compose.yml`), PBF extract download, and LIVE integration tests have been verified against an active local OSRM Docker container (`ghcr.io/project-osrm/osrm-backend:v5.27.1`) using the verified BBBike New Delhi extract (`https://download.bbbike.org/osm/bbbike/NewDelhi/NewDelhi.osm.pbf`, ~37.3 MB, bounding box: lat 28.44–28.738, lon 76.978–77.497). Unit tests and fallback paths are additionally verified against the local mock HTTP test suite.

---

## 1. Architecture Overview

FloodRelay solvers operate strictly **synchronously**. To provide realistic road distances and durations without making solver algorithms asynchronous or blocking the event loop:

1. **Two-Phase Routing Design**:
   - **Phase 1 (Async Prefetch)**: Before solver execution, `prepareTravelTimeProvider` gathers unique origins for road vehicles (`HIGH_WATER_VEHICLE`, `AMBULANCE`), requests, and shelters, chunks them to respect table coordinate limits (default $\le 100$ coordinates per request), and queries OSRM's `/table/v1/{profile}/...` Table API. If the scenario contains no road vehicles, zero OSRM requests are dispatched. The resulting road distances and durations are populated into an in-memory cache.
   - **Phase 2 (Sync Estimation)**: During solver execution, `getTravelEstimate(from, to, speedKmH, isFlooded, resourceType)` retrieves cached road distances synchronously in $O(1)$ time for road vehicles. For road vehicles with custom speed, duration is computed as `roadDistance / speedKmH * 60`. Non-road resources (`BOAT`, `HELICOPTER`) follow an explicit straight-line routing policy by design.
2. **Graceful Fallback**: If OSRM is not configured, unreachable, returns HTTP errors (e.g. 429 / 500), or times out, the provider automatically falls back to straight-line Euclidean/Haversine routing with an assumed 1.3 road detour multiplier, tagging fallback lookups accordingly.
3. **Hazard Decoration**: If `scenario.blockedZones` are defined, `HazardAwareTravelTimeProvider` wraps the provider, applying infinite penalty or flood impedance multipliers to legs intersecting hazard polygons.

---

## 2. Starting the OSRM Service (Docker Compose)

The OSRM service is defined under the `osrm` Docker Compose profile so default development builds (`docker compose up`) remain unaffected.

### Prerequisites

- Docker and Docker Compose installed.
- Internet connectivity to download the OpenStreetMap PBF extract.

### Configuration

In `.env` (or via environment variables):

```env
OSRM_BASE_URL=http://localhost:5000
OSRM_PROFILE=driving
OSRM_PORT=5000
OSRM_TIMEOUT_MS=5000
OSRM_MAX_TABLE_COORDINATES=100
# Must be set to an extract you have verified (HTTP 200) that covers your scenario area
# Verified BBBike extract covering North Delhi / Yamuna basin:
OSRM_PBF_URL=https://download.bbbike.org/osm/bbbike/NewDelhi/NewDelhi.osm.pbf
```

### Map Extract Coverage & Scenario Coordinates

- **Verified Extract:** BBBike NewDelhi extract (`https://download.bbbike.org/osm/bbbike/NewDelhi/NewDelhi.osm.pbf`, ~37.3 MB).
- **Extract Footprint (Bounding Box):** Latitude `[28.440, 28.738]`, Longitude `[76.978, 77.497]`.
- **Actual Scenario Entity Coordinates (`scenarios/sample-scenario.json`):**
  - Requests: Latitude `28.665`–`28.690`, Longitude `77.218`–`77.240`
  - Resources: Latitude `28.650`–`28.680`, Longitude `77.210`–`77.230`
  - Shelters: Latitude `28.668`–`28.705`, Longitude `77.228`–`77.232`
  - Hazard zones: Latitude `28.658`–`28.665`, Longitude `77.240`–`77.247`
  - All actual entity locations fall strictly inside the extract footprint (highest latitude is `28.705` at Wazirabad Shelter, well below `28.738`).
- **Metadata Bounding Box Distinction:**
  - The broad regional bounding box declared in scenario metadata (`metadata.bounds`: `minLat: 28.60, maxLat: 28.75, minLng: 77.18, maxLng: 77.28`) specifies `maxLat: 28.75`, which extends ~1.3 km beyond the extract northern boundary (`28.738`). No actual requests, resources, or shelters exist in that northern buffer zone.
- **Live Integration Test Synthetic Grid (`packages/solver/src/routing/osrmTravelTime.live.test.ts`):**
  - Origins: Latitude `28.600`–`28.659`, Longitude `77.200`–`77.259`
  - Destinations: Latitude `28.610`–`28.669`, Longitude `77.210`–`77.269`
  - All 120 coordinates fall strictly inside the extract boundary.

### Starting the Service

Run the following command to download the PBF extract, extract/partition/customize the graph, and launch the OSRM MLD routing engine:

```bash
docker compose -f infra/docker-compose.yml --profile osrm up -d
```

To stop the service:

```bash
docker compose -f infra/docker-compose.yml --profile osrm down
```

---

## 3. Verifying OSRM with `osrm-check.ts` and LIVE Tests

### Running the Verification Script

A dedicated CLI script `scenarios/osrm-check.ts` evaluates sample dispatch scenarios against both Straight-Line and OSRM providers across all three solvers (Nearest-First, Clarke-Wright Savings, and Cluster Allocation):

```bash
# Set OSRM_BASE_URL and run the check script
OSRM_BASE_URL=http://127.0.0.1:5000 npx tsx scenarios/osrm-check.ts
```

The script prints comparative tables for travel distance, travel duration, and the resulting `travelTime` report.

### Running the LIVE Test Suite

The dedicated live integration test suite in `packages/solver/src/routing/osrmTravelTime.live.test.ts` executes against an active OSRM container (and safely skips if `OSRM_BASE_URL` is unset):

```bash
OSRM_BASE_URL=http://127.0.0.1:5000 npx vitest run packages/solver/src/routing/osrmTravelTime.live.test.ts
```

The live test verifies:

- Estimated durations and distances are finite positive numbers.
- Requests exceeding 100 coordinates (60 origins, 60 destinations = 120 coordinates) are properly chunked across multiple HTTP calls.
- `osrmFailedRequests` is 0.

---

### Hazard Zone Policies & Leg Cost Semantics

Operator-defined hazard polygons apply spatial impedance or outright exclusion to legs intersecting the polygon geometry. The resulting leg cost depends on the zone severity and the configured blocked policy:

| Zone Type (`severity`) | Policy: `INFINITE` (Default)                                                                          | Policy: `PENALTY`                                                                                     |
| :--------------------- | :---------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| `BLOCKED`              | Leg blocked: `distance = Infinity`, `duration = Infinity`, `blocked = true`, `hazard = 'BLOCKED'`     | Leg penalized: `baseCost * penaltyMultiplier` (default 10.0x), `blocked = true`, `hazard = 'BLOCKED'` |
| `WATER_SURGE`          | Leg impedance: `baseCost * ASSUMED_WATER_SURGE_IMPEDANCE_MULTIPLIER` (2.0x), `hazard = 'WATER_SURGE'` | Leg impedance: `baseCost * ASSUMED_WATER_SURGE_IMPEDANCE_MULTIPLIER` (2.0x), `hazard = 'WATER_SURGE'` |
| `CAUTION`              | Leg impedance: `baseCost * ASSUMED_CAUTION_IMPEDANCE_MULTIPLIER` (1.25x), `hazard = 'CAUTION'`        | Leg impedance: `baseCost * ASSUMED_CAUTION_IMPEDANCE_MULTIPLIER` (1.25x), `hazard = 'CAUTION'`        |

Clear legs outside all hazard polygons receive unaltered baseline travel estimates (1.0x).

## 4. Understanding the `travelTime` Report

Every proposal generated via `POST /assignments/propose` includes a `travelTime` report object in the response and audit event log:

```json
{
  "effectiveSource": "OSRM",
  "osrmConfigured": true,
  "osrmRequests": 1,
  "osrmFailedRequests": 0,
  "lookupsOsrm": 18,
  "lookupsStraightLinePolicy": 0,
  "lookupsFallback": 0,
  "roadCoveragePercent": 100.0,
  "hazardZoneCount": 1,
  "warnings": []
}
```

### Field Definitions:

- **`effectiveSource`**:
  - `'OSRM'`: All solver lookups were resolved using OSRM road graph cells.
  - `'STRAIGHT_LINE'`: OSRM was unconfigured or failed completely; straight-line estimates used.
  - `'MIXED'`: Some legs resolved via OSRM, while unroutable coordinates or failed chunks fell back to straight-line.
- **`osrmConfigured`**: `true` if `OSRM_BASE_URL` was provided.
- **`osrmRequests`**: Total HTTP table requests dispatched to OSRM.
- **`osrmFailedRequests`**: Total HTTP requests that failed (timeout, network error, 4xx/5xx).
- **`lookupsOsrm`**: Number of pairwise distance queries served from cached OSRM road network cells.
- **`lookupsStraightLinePolicy`**: Number of pairwise distance queries served via straight-line policy by design (for `BOAT` and `HELICOPTER` resources).
- **`lookupsFallback`**: Number of pairwise road-vehicle distance queries that fell back to straight-line due to OSRM cache misses, unroutable coordinates, or network failure.
- **`roadCoveragePercent`**: `(lookupsOsrm / (lookupsOsrm + lookupsFallback)) * 100` evaluated strictly over road-vehicle queries. Returns `null` when there are no road vehicles or no road queries; `0` if configured but all road queries fell back.
- **`hazardZoneCount`**: Number of active blocked or hazard zones evaluated.
- **`warnings`**: List of any warnings encountered during prefetch (e.g. chunk failure or point limit truncation).

---

## 5. Technical Limitations & Operational Assumptions

1. **Per-Resource Routing Policy**: OSRM routes exclusively over road networks (`driving` profile with car.lua). Only road vehicles (`HIGH_WATER_VEHICLE`, `AMBULANCE`) query OSRM road distance. Marine craft (`BOAT`) and aerial craft (`HELICOPTER`) use straight-line geodesic calculations by design and do not follow road topology. OSRM does not compute navigable river channels or air corridors.
2. **Straight-Line Hazard Intersections**: Hazard collision detection (`zonesCrossedBySegment`) currently evaluates line segments connecting origin and destination coordinates, rather than the intermediate polyline of the road route.
3. **Sequential Chunk Prefetching**: Prefetch chunks are requested sequentially to avoid overwhelming lightweight OSRM instances or hitting public rate limits.
4. **Public Demo Server Limits**: Using public OSRM demo servers (`router.project-osrm.org`) in production is prohibited by their usage policy and rate limits. Always deploy a dedicated local instance via Docker Compose.
5. **Request-Scoped Hazard Zones & Plan Explainability**:
   - **No Entity Persistence / No Zone CRUD**: Hazard zones are supplied per-proposal as request-scoped inputs (`blockedZones`). They are not persisted as database entities, and there is no standalone Zone CRUD API (e.g. `POST /zones`).
   - **Audit Logging of Hazard Input**: To ensure dispatch decisions remain explainable and reproducible, the `ASSIGNMENT_PROPOSED` audit log stores the validated `hazardZones` input and its SHA-256 canonical JSON hash (`hazardZonesHash`).
   - **Frozen Committed Stops Invariant**: Committed stops marked frozen (`is_frozen = true`) represent active rescue missions and are never rerouted or cancelled by subsequent proposals. If a newly introduced hazard zone intersects a frozen leg, the route is preserved as-is and a warning is emitted in `travelTime.warnings`.
