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
  "lookupsOutsideCoverage": 0,
  "roadCoveragePercent": 100.0,
  "hazardZoneCount": 1,
  "regions": [
    {
      "id": "default",
      "requests": 1,
      "failedRequests": 0,
      "lookupsOsrm": 18
    }
  ],
  "warnings": []
}
```

### Field Definitions:

- **`effectiveSource`**:
  - `'OSRM'`: All solver lookups were resolved using OSRM road graph cells.
  - `'STRAIGHT_LINE'`: OSRM was unconfigured, failed completely, or no road lookups resolved via OSRM (for example, all scenario points fell outside every configured region); straight-line estimates used.
  - `'MIXED'`: Some legs resolved via OSRM, while `BOAT`/`HELICOPTER` policy legs, unroutable/failed fallbacks, cross-region legs, or outside-coverage legs used straight-line estimates.
- **`osrmConfigured`**: `true` if `OSRM_REGIONS` or `OSRM_BASE_URL` produced at least one active OSRM region configuration.
- **`osrmRequests`**: Total HTTP table requests dispatched across all configured OSRM regions.
- **`osrmFailedRequests`**: Total HTTP requests that failed across all configured OSRM regions (timeout, network error, 4xx/5xx).
- **`lookupsOsrm`**: Number of pairwise distance queries served from cached OSRM road network cells across all regions.
- **`lookupsStraightLinePolicy`**: Number of pairwise distance queries served via straight-line policy by design (for `BOAT` and `HELICOPTER` resources).
- **`lookupsFallback`**: Number of pairwise road-vehicle distance queries inside a region's bbox that fell back to straight-line due to OSRM cache misses, unroutable coordinates, or network failure.
- **`lookupsOutsideCoverage`**: Number of pairwise road-vehicle distance queries served via straight-line because at least one endpoint fell outside every configured region's bbox, or because the leg crossed from one region into another.
- **`roadCoveragePercent`**: `(lookupsOsrm / (lookupsOsrm + lookupsFallback + lookupsOutsideCoverage)) * 100` evaluated strictly over road-vehicle queries (`lookupsOutsideCoverage` counts as non-road-routed in the denominator; `BOAT` and `HELICOPTER` policy lookups are excluded). Returns `null` when there are no road-vehicle queries; `0` if configured but all road queries fell back or were outside coverage.
- **`hazardZoneCount`**: Number of active blocked or hazard zones evaluated.
- **`regions`**: Per-region breakdown (`id`, `requests`, `failedRequests`, `lookupsOsrm`) in configuration order (`[]` when OSRM is unconfigured; `"default"` when configured via `OSRM_BASE_URL`).
- **`warnings`**: List of any warnings encountered during preparation or prefetch (for example, out-of-coverage scenario points, chunk failure, or per-scenario point limit truncation).

---

## India zones

All six India sub-region extracts listed on `https://download.geofabrik.de/asia/india.html` were verified via `curl.exe -IL` on **2026-11-12** (`307 Temporary Redirect` → dated extract file returning `HTTP/1.1 200 OK`):

| Compose Profile  | Zone               | Verified Download URL (`-latest.osm.pbf`)                                    | HTTP Status (`curl.exe -IL`) | `Content-Length` (bytes / page MB) | `.poly` Coordinate Extent (`minLat..maxLat`, `minLng..maxLng`) |
| :--------------- | :----------------- | :--------------------------------------------------------------------------- | :--------------------------- | :--------------------------------- | :------------------------------------------------------------- |
| `osrm-north`     | Northern Zone      | `https://download.geofabrik.de/asia/india/northern-zone-latest.osm.pbf`      | `307` → `200 OK`             | `224,864,535` (`214 MB`)           | lat `23.0469..35.7309`, lng `69.4391..79.4888`                 |
| `osrm-south`     | Southern Zone      | `https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf`      | `307` → `200 OK`             | `559,594,968` (`533 MB`)           | lat `5.9439..19.9227`, lng `70.2079..95.5138`                  |
| `osrm-central`   | Central Zone       | `https://download.geofabrik.de/asia/india/central-zone-latest.osm.pbf`       | `307` → `200 OK`             | `352,234,209` (`335 MB`)           | lat `17.7709..31.4908`, lng `74.0149..84.6466`                 |
| `osrm-east`      | Eastern Zone       | `https://download.geofabrik.de/asia/india/eastern-zone-latest.osm.pbf`       | `307` → `200 OK`             | `247,694,659` (`236 MB`)           | lat `17.7806..27.5284`, lng `81.3675..89.9183`                 |
| `osrm-west`      | Western Zone       | `https://download.geofabrik.de/asia/india/western-zone-latest.osm.pbf`       | `307` → `200 OK`             | `222,190,887` (`211 MB`)           | lat `14.3893..24.7176`, lng `67.6746..80.9136`                 |
| `osrm-northeast` | North-Eastern Zone | `https://download.geofabrik.de/asia/india/north-eastern-zone-latest.osm.pbf` | `307` → `200 OK`             | `109,984,098` (`104 MB`)           | lat `21.9271..29.4288`, lng `88.0085..97.4199`                 |

_(Snapshot `Last-Modified` observed from headers: `Wed, 11 Nov 2026 23:54–23:55 GMT`.)_

> **Coverage note:** Geofabrik's India HTML pages display zone boundaries interactively via `.kml`/`.poly` files and do not publish a prose state-by-state list on the web pages. Because `.poly` polygons are non-rectangular, their outer axis-aligned extents overlap across neighboring zones; inspect the corresponding Geofabrik zone KML map and re-verify URLs with `curl.exe -IL <url>` before choosing `OSRM_REGIONS` bounding boxes for production scenarios.

---

## Running more than one region

- **One extract per container**: Each OSRM server container loads one preprocessed road graph (`/data/region.osm.pbf` → `/data/region.osrm`). A single OSRM container cannot merge two separate extracts cleanly.
- **Regional Compose profiles**: [infra/docker-compose.yml](file:///d:/INT227_project/infra/docker-compose.yml) keeps the default Delhi `osrm` profile on port `5000` unchanged and adds six isolated zone profiles:
  - `osrm-north` (`port 5001`, volume `floodrelay-osrm-data-north`, `OSRM_PBF_URL_NORTH`)
  - `osrm-south` (`port 5002`, volume `floodrelay-osrm-data-south`, `OSRM_PBF_URL_SOUTH`)
  - `osrm-central` (`port 5003`, volume `floodrelay-osrm-data-central`, `OSRM_PBF_URL_CENTRAL`)
  - `osrm-east` (`port 5004`, volume `floodrelay-osrm-data-east`, `OSRM_PBF_URL_EAST`)
  - `osrm-west` (`port 5005`, volume `floodrelay-osrm-data-west`, `OSRM_PBF_URL_WEST`)
  - `osrm-northeast` (`port 5006`, volume `floodrelay-osrm-data-northeast`, `OSRM_PBF_URL_NORTHEAST`)
- **Start only the zones you need**:
  ```bash
  docker compose -f infra/docker-compose.yml --profile osrm-north up -d
  ```
  Download init containers fail fast (exit code `1`) with an explicit message if that zone's `OSRM_PBF_URL_*` variable is blank.
- **Updating or switching a region's extract**: Changing `OSRM_PBF_URL` or `OSRM_PBF_URL_*` alone does **not** re-download or rebuild the routing graph because `osrm-download*` skips when `/data/region.osm.pbf` already exists in the named volume and `osrm-prep*` skips when `/data/region.osrm.partition` already exists. To replace an extract:
  1. `docker compose -f infra/docker-compose.yml --profile <profile> down`
  2. `docker volume rm <volume>` _(for example `floodrelay-osrm-data` or `floodrelay-osrm-data-north`; this deletes the currently loaded map and prepared graph)_
  3. Update the `OSRM_PBF_URL*` and matching `OSRM_REGIONS` / `OSRM_COVERAGE_BBOX` values in `.env`
  4. `docker compose -f infra/docker-compose.yml --profile <profile> up -d`
- **Memory planning**:
  - OSRM keeps the processed MLD graph resident in RAM (`osrm-routed --algorithm mld`).
  - Measured fact from this repository's setup: for the **35.6 MiB New Delhi extract**, the `osrm-prep` log reported a peak of about **632 MB RAM**. Larger extracts scale roughly with `.osm.pbf` file size (estimate only).
  - Running all six India zones simultaneously (`~1.6 GB` total compressed `.osm.pbf`) needs a server with **much more RAM than a 16 GB laptop**. Start only the specific regional profile(s) required for your operational sector, measure actual peak RAM during `osrm-prep*` (`docker stats --no-stream` / container logs) for each loaded zone, and record the observed numbers.
- **Why explicit coverage bounding boxes matter (snapping & cross-region legs)**:
  - By default, OSRM snaps any queried coordinate—even hundreds of kilometers away—to the nearest road node in its loaded extract, which can return misleading road distances and times for out-of-area points.
  - With `OSRM_REGIONS` (or `OSRM_BASE_URL` + `OSRM_COVERAGE_BBOX`), `RegionalTravelTimeProvider` routes a road leg (`HIGH_WATER_VEHICLE`, `AMBULANCE`) via a region's OSRM container **only when BOTH endpoints lie inside that region's inclusive bounding box**.
  - Points outside every configured region are excluded from all OSRM table prefetches (zero HTTP requests if no scenario point falls in any region).
  - **Cross-region routes (spanning two zones)** and **outside-coverage legs** automatically fall back to straight-line estimation (`source: 'STRAIGHT_LINE'`), increment `lookupsOutsideCoverage`, and trigger `"N of M scenario points are outside every configured OSRM region; straight-line estimates used"` when `N > 0`.

---

## Road-Following Route Geometry (`RouteGeometry`)

While OSRM `/table/v1/` supplies fast travel-time and distance matrices during optimization, road-following polylines (`RouteGeometry` on `ResourceRoute.geometry`) are fetched separately after route construction via `enrichRoutesWithGeometry` ([packages/solver/src/routing/routeGeometry.ts](file:///d:/INT227_project/packages/solver/src/routing/routeGeometry.ts)):

1. **Endpoint Query & Format**: For each covered road leg (`from -> to`), `OsrmTravelTimeProvider.fetchRouteLegGeometry` queries `GET /route/v1/{profile}/{lng1},{lat1};{lng2},{lat2}?overview=full&geometries=geojson&steps=false` and converts GeoJSON `[lng, lat]` vertices to `[lat, lng]` pairs.
2. **Waypoint Ordering & Vertex Deduplication**: Routes whose first stop is not a `DEPOT` begin at the assigned resource's starting `(lat, lng)` (`fromStopNumber: 0`). Consecutive leg polylines are concatenated with duplicate boundary vertices removed.
3. **Policy & Coverage Isolation**:
   - `BOAT` and `HELICOPTER` routes remain straight-line (`source: 'STRAIGHT_LINE'`) with zero `/route/v1/` HTTP calls.
   - Road legs with either endpoint outside every configured region's bounding box (or spanning two different regions) fall back to two-point straight-line segments (`source: 'STRAIGHT_LINE'`) without contacting OSRM; mixed routes report `source: 'MIXED'`.
4. **Distance, Duration & Hazard Scaling**: Road legs honor `useResourceSpeed` (`(distanceKm / speedKmH) * 60` when enabled) and apply active `blockedZones` impedance multipliers via `HazardAwareTravelTimeProvider`.
5. **Proposal, Repair & Retrieval Hydration**: `AssignmentService.proposeAssignment`, `IncrementalRepairSolverAdapter`, and `AssignmentService.getAssignment` attach `RouteGeometry` (storing snapshots in `ASSIGNMENT_PROPOSED` / `REPAIR_PROPOSAL_GENERATED` audit payloads and recomputing whenever stops are modified or uncached) while populating accurate per-route `totalTravelDistanceKm`.

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
