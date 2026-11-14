# Technology and Change Log

---

## Task A: India-Wide OSRM Regions and Coverage Control — Branch `feat/osrm-regions` (`2026-11-12`)

**Base Ref:** `origin/main` (`aa3589c`)

### 1. Technologies Added

- **None: no new dependency.** All validation, bounding-box filtering, multi-region dispatch, and test servers use TypeScript, Node built-ins (`node:http`, `node:fs`, global `fetch`), Vitest, Docker Compose YAML anchors, and existing `osrm-backend:v5.27.1` / `curlimages/curl:8.10.1` images.

### 2. Technologies Reused

- **OSRM Table HTTP API (`/table/v1/{profile}/...`)** via `OsrmTravelTimeProvider` prefetch-and-cache pattern (`packages/solver/src/routing/osrmTravelTime.ts`).
- **Two-phase synchronous travel-time provider pattern** (`prepareTravelTimeProvider` + `RegionalTravelTimeProvider` + `HazardAwareTravelTimeProvider`).
- **Docker Compose extension blocks (`x-*` YAML anchors)** and per-profile named volumes (`infra/docker-compose.yml`).
- **OpenAPI 3.1 JSON Schema + Supertest / Vitest anti-drift validation** (`services/api/src/openapi.json`, `docs/openapi.json`, `services/api/src/openapi.test.ts`).
- **Node `node:http` fake OSRM servers** in `packages/solver/src/routing/osrmHttp.test.ts`.

### 3. Configuration Added

- **Environment variables (`.env.example` — commented / blank defaults):**
  - `OSRM_COVERAGE_BBOX`: optional `"minLat,minLng,maxLat,maxLng"` decimal-degree bbox when using `OSRM_BASE_URL` (commented Delhi example `28.44,76.98,28.74,77.50`; default unset).
  - `OSRM_REGIONS`: optional JSON array of `{"id","baseUrl","bbox","profile"?}` objects (when set cleanly, overrides `OSRM_BASE_URL`; default unset).
  - `OSRM_PBF_URL_NORTH`, `OSRM_PBF_URL_SOUTH`, `OSRM_PBF_URL_CENTRAL`, `OSRM_PBF_URL_EAST`, `OSRM_PBF_URL_WEST`, `OSRM_PBF_URL_NORTHEAST` (blank by default).
- **Docker Compose services (`infra/docker-compose.yml`):**
  - Added six optional profiles without modifying the default `osrm` profile (port `5000`):
    - `osrm-north` (`5001:5000`, `floodrelay-osrm-data-north`, containers `floodrelay-osrm-{download,prep,}-north`)
    - `osrm-south` (`5002:5000`, `floodrelay-osrm-data-south`, containers `floodrelay-osrm-{download,prep,}-south`)
    - `osrm-central` (`5003:5000`, `floodrelay-osrm-data-central`, containers `floodrelay-osrm-{download,prep,}-central`)
    - `osrm-east` (`5004:5000`, `floodrelay-osrm-data-east`, containers `floodrelay-osrm-{download,prep,}-east`)
    - `osrm-west` (`5005:5000`, `floodrelay-osrm-data-west`, containers `floodrelay-osrm-{download,prep,}-west`)
    - `osrm-northeast` (`5006:5000`, `floodrelay-osrm-data-northeast`, containers `floodrelay-osrm-{download,prep,}-northeast`)

### 4. API Changes & OpenAPI Delta

- **Updated schema:** `POST /assignments/propose` response field `data.travelTime` (`#/components/schemas/TravelTimeReport`) and `ASSIGNMENT_PROPOSED` audit log payload:
  - Added new schema `TravelTimeRegionReport` (`required: ["id", "requests", "failedRequests", "lookupsOsrm"]`).
  - Extended `TravelTimeReport.required` & `properties` with:
    - `lookupsOutsideCoverage` (`integer`, minimum `0`)
    - `regions` (`array` of `$ref: "#/components/schemas/TravelTimeRegionReport"`)
- Updated both `services/api/src/openapi.json` and `docs/openapi.json` (kept byte-identical).

### 5. Behavior Changes Visible to Users or Operators

- When `OSRM_REGIONS` or `OSRM_COVERAGE_BBOX` is configured, points outside every configured region's bbox are never sent to any OSRM server; out-of-coverage and cross-region legs receive straight-line (`Haversine * 1.3`) estimates tagged `source: 'STRAIGHT_LINE'`, preventing OSRM's nearest-road snap distortion.
- `TravelTimeReport` now reports per-region request/lookup stats (`regions[]`), `lookupsOutsideCoverage`, updated `roadCoveragePercent` (treating outside-coverage road-vehicle lookups as non-road-routed), and a warning `"N of M scenario points are outside every configured OSRM region; straight-line estimates used"` when `N > 0`.
- When neither `OSRM_REGIONS` nor `OSRM_COVERAGE_BBOX` is set, single-region `OSRM_BASE_URL` and straight-line solver behavior remain identical to prior behavior (with `regions: [{ id: "default", ... }]` when `OSRM_BASE_URL` is set and `regions: []` when unconfigured).

### 6. Files Added and Files Changed

- **Added:**
  - `packages/solver/src/routing/regionalTravelTime.ts`
  - `packages/solver/src/routing/regionalTravelTime.test.ts`
  - `docs/technology-and-changes.md`
- **Changed:**
  - `.env.example`
  - `packages/solver/src/index.ts`
  - `packages/solver/src/routing/osrmTravelTime.ts`
  - `packages/solver/src/routing/travelTimeFactory.ts`
  - `packages/solver/src/routing/travelTimeFactory.test.ts`
  - `packages/solver/src/routing/osrmHttp.test.ts`
  - `services/api/src/openapi.json`
  - `docs/openapi.json`
  - `services/api/src/routes/assignmentsOsrm.test.ts`
  - `infra/docker-compose.yml`
  - `docs/osrm.md`
  - `scenarios/osrm-check.ts`

### 7. Known Limitations and What Is Not Covered

- **Single-region per leg / cross-zone fallback:** Legs whose origin and destination lie in two different regional bounding boxes cannot be stitched across separate OSRM containers here and fall back to straight-line estimation.
- **Axis-aligned rectangular bboxes vs non-rectangular states:** Bounding boxes overlap across neighboring non-rectangular Geofabrik `.poly` extracts; operators must define non-overlapping `OSRM_REGIONS` bounding boxes or order preferred regions intentionally.
- **Boat & helicopter policy:** Marine and aerial assets always use straight-line geodesic distance regardless of OSRM configuration.
- **Static road graph & no flood awareness inside OSRM:** OSRM routing graphs are static OpenStreetMap snapshots; flood zone exclusions remain straight-line geometric checks in `HazardAwareTravelTimeProvider`.
- **Memory constraint on consumer hardware:** Loading all six India regional extracts concurrently requires more RAM than a standard 16 GB laptop (only start needed zones and record `docker stats` peak RAM during prep).

### 8. How to Verify

```bash
# Lint, typecheck, format check, OpenAPI parity
npm run lint
npm run typecheck
npx prettier --check . --end-of-line auto
cmp -s services/api/src/openapi.json docs/openapi.json

# Routing & API unit/integration tests
npx vitest run packages/solver/src/routing/regionalTravelTime.test.ts packages/solver/src/routing/travelTimeFactory.test.ts packages/solver/src/routing/osrmHttp.test.ts services/api/src/routes/assignmentsOsrm.test.ts services/api/src/openapi.test.ts

# Docker Compose regional profiles validation
docker compose -f infra/docker-compose.yml --profile osrm-north config --services

# Default-behavior regression check
npx tsx scenarios/evaluate.ts
```

---

## Task B — Road-Following Route Geometry & Distance/Duration Hydration (feat/route-geometry)

### 1. Problem Addressed

Solving routes via OSRM `/table/v1/` alone left map polylines connecting stop coordinates with straight segments and left `GET /assignments/:id` reporting `totalTravelDistanceKm: 0` when reconstructing routes from persisted stops.

### 2. What Changed

- **Shared Contract (`packages/shared/src/index.ts`)**: Added `RouteGeometrySource`, `RouteLegGeometry`, `RouteGeometry`, and optional `geometry?: RouteGeometry` on `ResourceRoute`.
- **Solver Route Geometry Engine (`packages/solver/src/routing/osrmTravelTime.ts`, `routeGeometry.ts`, `travelTimeFactory.ts`)**:
  - Added `OsrmTravelTimeProvider.fetchRouteLegGeometry` querying `/route/v1/{profile}/...?overview=full&geometries=geojson&steps=false` and converting GeoJSON `[lng, lat]` coordinates to `[lat, lng]` with per-leg caching.
  - Added `enrichRoutesWithGeometry` and `mergeRouteCoordinates` enforcing `BOAT`/`HELICOPTER` straight-line policy, dual-endpoint regional bbox isolation, `useResourceSpeed` & `HazardAwareTravelTimeProvider` scaling, and fallback straight-line segments on OSRM errors.
- **API & Repair Pipeline (`services/api/src/services/assignmentService.ts`, `incrementalRepairSolverAdapter.ts`, `repairOrchestrationService.ts`)**:
  - Enriched `POST /assignments/propose` and `POST /operations/repair` plans with `RouteGeometry` and stored compact `routeGeometries` payloads in `ASSIGNMENT_PROPOSED` / `REPAIR_PROPOSAL_GENERATED` audit events.
  - Updated `GET /assignments/:id` to hydrate `route.geometry` and accurate `totalTravelDistanceKm` (from valid cached payloads or fresh recomputation after stop edits).
- **OpenAPI Spec (`services/api/src/openapi.json`, `docs/openapi.json`)**: Added `RouteGeometrySource`, `RouteLegGeometry`, `RouteGeometry`, and `ResourceRoute.geometry` (kept byte-identical).
- **CLI (`scenarios/osrm-check.ts`)**: Added `Route Geometry Report (Cluster-Allocation)` showing live `/route/v1/` vertex counts, sources, and distances.

### 3. Preserved Defaults & Non-Goals

- `BOAT` and `HELICOPTER` remain straight-line (`0` OSRM requests).
- Solver optimization metrics and `scenarios/evaluate.ts` benchmark outputs remain identical when OSRM is unset.
- Zero new npm dependencies added; UI route rendering (`apps/web`) deferred to Task C.

---

## Task C — Google-Like Light Basemap & UI Route Rendering (feat/map-routes-ui)

### 1. Problem Addressed

The Operator Tactical Map previously defaulted to an inverted dark tile filter, did not fetch full assignment details (`routes[]` + `geometry`) when selecting an assignment, drew only straight lines connecting stop coordinates, and omitted per-route distance and source indicators on the map and assignment review pages.

### 2. What Changed

- **Basemap Theme Default (`apps/web/components/operator/map/tileConfig.ts`, `apps/web/app/operator/map/page.tsx`)**: Switched the default basemap theme to light Standard OpenStreetMap (`standard`) with clean Google-like floating controls while keeping the `DARK TACTICAL` toggle option intact.
- **Route Geometry Display & Leaflet Polylines (`apps/web/components/operator/map/routeDisplay.ts`, `LeafletMapCanvas.tsx`, `LeafletMapWrapper.tsx`)**:
  - Prefers Task B road-following `geometry.coordinates` (`[lat, lng]`) when available and splits `MIXED` routes per leg so OSRM road segments render in solid blue (`#1a73e8`) while `BOAT`/`HELICOPTER`/outside-coverage legs render as dashed teal straight-line segments.
  - Added interactive route `<Popup>` telemetry and assignment summary HUD badges (`N Route(s) • X.XX km • ~Y min • OSRM Road / Mixed / Straight-Line`).
- **Assignment Hydration & Review Page (`apps/web/app/operator/map/page.tsx`, `apps/web/app/operator/assignments/[id]/page.tsx`, `apps/web/lib/api/types.ts`)**:
  - Hydrates `apiClient.getAssignment(selectedAssignmentId)` on the map page with `AbortController` cleanup so persisted/proposed `RouteGeometry` renders immediately.
  - Displays per-route distance (`km`), duration (`min`), and routing source badge (`OSRM Road`, `Mixed (Road + SL)`, `Straight-Line`) on `/operator/assignments/[id]`.
- **Tests (`apps/web/__tests__/routeDisplay.test.ts`, `tileConfig.test.ts`, `operator-map.test.ts`)**: Added coverage for geometry preference, solid vs dashed styling, mixed per-leg splitting, default light theme, and metrics formatting.

### 3. Preserved Defaults & Non-Goals

- OpenStreetMap raster tiles remain in use (no proprietary Google Maps API dependency added); dark theme remains selectable.
- `BOAT`, `HELICOPTER`, and out-of-coverage legs stay visually dashed straight-line by design.
- Zero new npm dependencies added.
