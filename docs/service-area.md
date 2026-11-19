# FloodRelay — Delhi NCR Service-Area Enforcement & Spatial Intake Policy

This document defines FloodRelay's authoritative service-area boundary, spatial enforcement architecture, emergency intake contracts, operational dispatch scope, and the procedure for extending coverage to additional regions.

---

## 1. Supported Service-Area Definition

FloodRelay operates an authoritative geographic restriction policy for its **Delhi NCR** pilot deployment. Rescue request intake is restricted strictly to locations falling within the official constituent administrative districts of India's **National Capital Region (NCR)**.

Any rescue assistance request submitted with coordinates outside this boundary is **rejected at intake** before any database rows (requests, operational events, audit entries) are created.

> **Operational Boundary Principle:** Localised UI copy or geographic intake eligibility does **not** imply that physical rescue resources are available or dispatched. FloodRelay is a human-supervised decision-support prototype. In life-threatening emergencies, citizens must dial **112** (India's Emergency Response Support System).

---

## 2. Boundary Provenance, Version & Geographic Coverage

### Authoritative Government Sources

1. **National Capital Region Planning Board (NCRPB):**
   - Official portal: [https://ncrpb.nic.in/](https://ncrpb.nic.in/)
   - Constituent areas: [https://ncrpb.nic.in/ncrconstituent.html](https://ncrpb.nic.in/ncrconstituent.html)
   - PARIMAN GIS Portal: [https://ncrpbgis.nic.in/](https://ncrpbgis.nic.in/)
   - **Retained Geographical Extent:** As reaffirmed in the 16 June 2026 meeting of the NCRPB, the official geographical extent of the National Capital Region is retained at **~55,083 sq. km**.

2. **Administrative Boundary GIS Geometry:**
   - **Source Agency / Source:** Local Government Directory (`lgdirectory.gov.in`), Ministry of Panchayati Raj, Government of India, via Pathways Data Pvt. Ltd. and `geoBoundaries`.
   - **Dataset Release:** `geoBoundaries IND-ADM2-76128533` (Release commit `9469f09`, build date `2023-12-12`).
   - **Licence:** Open Data Commons Open Database License 1.0 (ODbL 1.0).
   - **Coordinate Reference System (CRS):** EPSG:4326 (WGS 84 latitude/longitude degrees).

### Version & Artifact Checksums

The project explicitly distinguishes between the following three checksums across metadata and integrity checks:

- **Repository GeoJSON SHA-256 (`repositoryGeoJsonSha256`):**
  - Value: `a48e65c666c374c07364e03c79d090a8c0888971f463f804d40baf052104e8ae`
  - File: `services/api/src/geo/delhi-ncr-boundary.geojson` (Prettier-formatted repository artifact verified at runtime by `loadDelhiNcrBoundaryDataset()`).
- **Upstream GIS Source File SHA-256 (`gisSourceFileSha256`):**
  - Value: `d68db39cd3e2d0892af268e2b0454166368ce3b5b8a78fcda63069ec92a641db`
  - Origin: `geoBoundaries-IND-ADM2_simplified.geojson` upstream download from wmgeolab commit `9469f09`.
- **Initial Raw Export SHA-256 (`initialRawExportSha256`):**
  - Value: `357d77cdf69c8f5f4016c0c656e70cfcb8b1d585dcba5849e95a15299478fd1d`
  - Origin: Unformatted single-line raw extraction artifact prior to codebase formatting.
- **Computed Geodesic Area:** **55,223.3 sq. km** (within 0.25% of NCRPB's published 55,083 sq. km figure).
- **Topology Integrity:** 0 unclosed rings, 0 duplicate consecutive vertices, 0 holes, 0 proper self-intersections across 9,510 boundary vertices.

### Boundary Provenance, Limitations & Positional Uncertainty

- **Provenance Characterisation:** The boundary represents an **NCRPB constituent-area-based geographic boundary derived from documented administrative GIS polygons** (`lgdirectory.gov.in` via `geoBoundaries` ADM2). It is **not** a cadastral parcel survey or revenue-village-level land record.
- **Constituent Count vs Notified Districts:** The dataset comprises **34 ADM2 polygon features** covering the 35 notified administrative districts:
  - **NCT of Delhi (11 Districts, 1,483 sq. km):** 11 district polygons (Central Delhi, East Delhi, New Delhi, North Delhi, North East Delhi, North West Delhi, Shahdara, South Delhi, South East Delhi, South West Delhi, West Delhi).
  - **Haryana Sub-Region (14 Notified Districts, 25,327 sq. km):** 13 polygon features covering 14 notified districts (Faridabad, Gurugram, Nuh/Mewat, Rohtak, Sonipat, Rewari, Jhajjar, Panipat, Palwal, Bhiwani, Mahendragarh, Jind, Karnal). The Charkhi Dadri district, bifurcated from Bhiwani, is enclosed within the unified Bhiwani ADM2 polygon in the 2021 LGD release; both districts are 100% within the NCR.
  - **Uttar Pradesh Sub-Region (8 Districts, 14,826 sq. km):** 8 district polygons (Meerut, Ghaziabad, Gautam Buddha Nagar/Noida & Greater Noida, Bulandshahr, Baghpat, Hapur, Shamli, Muzaffarnagar).
  - **Rajasthan Sub-Region (2 Districts, 13,447 sq. km):** 2 district polygons (Alwar, Bharatpur; covering recent administrative sub-district splits consistent with NCRPB retention of historical geographical extent).
- **Positional Uncertainty:** The simplified polygon geometry (~9,510 vertices across 34 constituent features) exhibits approximately **100–300 meters** of positional uncertainty relative to Survey of India high-resolution cadastral boundaries.

---

## 3. Database & Spatial Query Implementation (PostGIS)

### Schema & Indexing (`infra/migrations/005_service_areas.sql`)

Service areas are stored in PostgreSQL/PostGIS in the `service_areas` table:

```sql
CREATE TABLE IF NOT EXISTS service_areas (
  region_id VARCHAR(32) PRIMARY KEY,
  region_name VARCHAR(128) NOT NULL,
  boundary_version VARCHAR(64) NOT NULL,
  geometry GEOMETRY(MultiPolygon, 4326) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_areas_geometry_gist
  ON service_areas USING GIST (geometry);
```

During migration `005`, the 34 constituent administrative polygons are collected and dissolved into a single unified polygon using PostGIS:

```sql
ST_Multi(ST_MakeValid(ST_UnaryUnion(ST_Collect(geom))))
```

A migration validation block (`DO $$ ... $$`) programmatically asserts:

1. `ST_IsValid(geometry) = TRUE`
2. `ST_SRID(geometry) = 4326`
3. Dissolved geodesic area `ST_Area(geometry::geography) / 1000000.0` falls within `[54000, 57000]` sq. km.

### Spatial Evaluation & Inclusive Boundary Policy

Spatial point-in-polygon queries execute using `ST_Covers`:

```sql
SELECT
  region_id as "regionId",
  region_name as "regionName",
  boundary_version as "boundaryVersion",
  ST_IsValid(geometry) as "isValid",
  ST_SRID(geometry) as "srid",
  ST_Covers(geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326)) as "isCovered"
FROM service_areas
WHERE is_active = TRUE
ORDER BY region_id ASC
LIMIT 1;
```

- **Policy:** `ST_COVERS` is strictly boundary-inclusive. A point lying exactly on the outer boundary or internal district seam is classified as `eligible: true` (unlike `ST_Contains`, which excludes boundary points).
- **Coordinate Order:** In PostGIS, `ST_MakePoint($1, $2)` takes longitude `$1` first, followed by latitude `$2`.
- **Performance:** PostGIS utilizes the GiST spatial R-tree index for $O(\log N)$ containment lookups.

---

## 4. API Error Contracts & Behavior

### Public Service-Area Check (`POST /requests/service-area-check`)

Inspects coordinates without authentication:

- **Request Body:** `{ "lat": 28.6139, "lng": 77.209 }`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "eligible": true,
      "regionId": "IN-NCR",
      "regionName": "Delhi NCR",
      "boundaryVersion": "ncrpb-2026-gb-ind-adm2-v1",
      "inclusiveBoundaryPolicy": "ST_COVERS"
    }
  }
  ```
- **Validation Failure (400 Bad Request):** If `lat` or `lng` are non-finite, out of range ($[-90, 90]$ or $[-180, 180]$), or missing.
- **Fail-Closed Failure (503 Service Unavailable):** If the boundary dataset is missing, corrupted, or PostGIS is unreachable.

### Rescue Request Submission (`POST /requests`)

- **Outside Service Area (422 Unprocessable Entity):**
  When coordinates lie outside the supported Delhi NCR boundary:
  ```json
  {
    "error": {
      "code": "OUTSIDE_SERVICE_AREA",
      "message": "FloodRelay currently accepts rescue requests only within its supported Delhi NCR service area.",
      "timestamp": "2026-11-18T18:00:00.000Z"
    }
  }
  ```
  - **Zero Database Writes:** No rows are written to `requests`, `operational_events`, or `audit_events`.
  - **No Receipt Generated:** Neither server nor client produces a confirmation receipt or request ID.
- **Fail-Closed Service-Area Error (503 Service Unavailable):**
  If the active boundary cannot be evaluated at request time:
  ```json
  {
    "error": {
      "code": "SERVICE_AREA_UNAVAILABLE",
      "message": "Unable to verify Delhi NCR service-area eligibility right now. Please try again shortly, or call 112 if you are in immediate danger.",
      "timestamp": "2026-11-18T18:00:00.000Z"
    }
  }
  ```
  - Sanitized error message: Never exposes SQL, file paths, PostGIS internals, or stack traces.
  - Never falsely tells the citizen that their location is outside NCR when the system simply cannot determine it.
- **Idempotency Semantics:**
  - Idempotency key payload modifications continue to return HTTP 409 `IDEMPOTENCY_KEY_REUSED` before spatial checks.
  - An eligible idempotent replay returns HTTP 200 with the existing request.
  - A historical pre-policy out-of-NCR idempotency key replay is evaluated against the service area and rejected with HTTP 422 `OUTSIDE_SERVICE_AREA`, preventing silent replay of old receipts for currently ineligible areas.

---

## 5. Citizen Portal Guidance & Receipt Protection

### User Guidance Flow

1. **Coordinate Entry:** Citizen acquires coordinates via device GPS, forward geocoding candidate selection, or manual coordinate entry.
2. **Exact Spatial Check:** The UI evaluates exact coordinates via `POST /requests/service-area-check`. (Approximate landmark labels or address text are never used for boundary checks).
3. **Step 3A (Eligible):** Confirms location eligibility and enables form submission.
4. **Step 3B (Outside NCR):**
   - Blocks submission (submit button disabled).
   - Preserves all entered form data (address, water level, party count, special needs, notes).
   - Displays exact required heading:
     **`Location Outside FloodRelay's Service Area`**
   - Displays emergency copy directing immediate danger to **Call 112**.
   - Provides 3 actionable controls:
     - **Call 112** (`tel:112`)
     - **Change Location** (focuses address input without clearing entered details)
     - **Try Location Check Again**
   - Never displays ticket numbers, confirmation banners, or dispatch promises.
5. **Step 3C (Check Unavailable):**
   - Informs citizen that check is temporarily unavailable without claiming the location is outside NCR.
   - Preserves all entered form data.
   - Provides **Call 112** (`tel:112`) and **Try Location Check Again**.
6. **Step 3D (Near NCR Boundary Uncertainty Guidance):**
   - Triggered when coordinates lie outside the NCR boundary polygon but within the conservative 1,000 m proximity buffer (`distanceToBoundaryMeters <= 1000`).
   - **Critical Safety Rule:** Never bypasses server-side `ST_Covers` enforcement or expands coverage. Server rejects submission with HTTP 422 `OUTSIDE_SERVICE_AREA`. Zero database rows are written.
   - Blocks submission (submit button disabled). Preserves all entered form data.
   - Displays exact copy:
     > _"Your location is close to the Delhi NCR service-area boundary. FloodRelay cannot confirm that this location is supported. Please verify your address or adjust the map pin. No rescue request has been submitted. If you are in immediate danger, call 112."_
   - Provides actionable controls: **Call 112**, **Change Location**, and **Try Location Check Again**.

### Confirmation Page Safeguards (`CitizenReceiptCard.tsx`)

- The confirmation page `/citizen/confirmation` only renders a receipt after confirmed API success (`status: 201` or idempotent `200`).
- If a submission is rejected with 422 or 503, `sessionStorage` records `floodrelay_last_submission_outcome` with status `REJECTED_OUTSIDE` or `UNAVAILABLE`.
- Stale `sessionStorage` receipts are guarded: If a citizen experienced a rejected submission, navigating to `/citizen/confirmation` renders a rejection alert screen rather than displaying an older receipt as confirmation of the rejected attempt.
- Legitimate earlier receipts from previous submissions remain viewable via an explicit, separated disclosure toggle ("View Earlier Request Receipt").

---

## 6. Operational Planning vs Intake & Routing Limitations

### Intake Scope vs Fleet Dispatch Scope

- **Intake Area (~55,083 sq. km):** Encompasses all 34 districts of the National Capital Region across Delhi, Haryana, Uttar Pradesh, and Rajasthan.
- **OSRM Road Routing Extract Envelope (`28.44, 76.98, 28.74, 77.50`):**
  - The configured local OSRM road network extract covers central Delhi and the immediate Yamuna floodplain (~1,500 sq. km).
  - Locations inside NCR that fall outside this road extract gracefully fall back to straight-line Euclidean distance with travel-time warnings (`travelTime.warnings`).
  - **No False Road Routing:** Straight-line estimates are explicitly documented and never mislabeled as verified road routing.
- **Operational Proposal Filtering (`AssignmentService.proposeAssignment`):**
  - Excludes pre-existing historical out-of-NCR operational (`REPORTED` / `REAL`) requests, resources, and shelters from newly proposed assignments.
  - Excluded records are accurately reported in `unserved` as `ISOLATED_ZONE` ("outside the active Delhi NCR service area") and in `travelTime.warnings`.
  - Historical database rows are preserved (never deleted or rewritten).
  - Controlled `SIMULATED` scenarios remain preserved when opted in via `allowSimulated: true`.
- **Commitment Defense-in-Depth (`PostgisRepository.commitAssignment`):**
  - Under strict row lock, verifies that locked operational requests, resources, and shelters are located within active service areas using PostGIS `ST_Covers`.
  - Rejects foreign operational entities with HTTP 422 `OUTSIDE_SERVICE_AREA`.

---

## 7. Procedure for Adding Another Operational Region

To add a new operational service area (e.g. Mumbai MMR, Chennai, Kerala):

1. **Obtain Authoritative Boundary Geometry:**
   - Source constituent administrative polygons from official government GIS datasets (e.g. `lgdirectory.gov.in` / `geoBoundaries` ADM2).
   - Ensure CRS is EPSG:4326.
   - Verify topological closure, zero holes, and vertex consistency.
2. **Create New Migration:**
   - Add a new migration `infra/migrations/00X_add_<region>_service_area.sql`.
   - Insert row into `service_areas` with unique `region_id` (e.g. `'IN-MMR'`), `region_name`, `boundary_version`, and dissolved geometry using `ST_Multi(ST_MakeValid(ST_UnaryUnion(ST_Collect(...))))`.
   - Add verification block asserting `ST_IsValid` and expected surface area bounds.
3. **Configure Routing & Regional Defaults:**
   - If dedicated OSRM routing is available, configure `OSRM_REGIONS` environment variable (e.g. `[{"id":"mumbai","bounds":...}]`).
   - Register regional presets in `apps/web/lib/region.ts`.
4. **Add Regression Tests:**
   - Add verified point tests in `serviceAreaEnforcement.test.ts` and `integration.test.ts`.
   - Add rollback tests in `00X_add_<region>_service_area.down.sql`.

---

## 8. Mandatory Deployment Sequence & Configuration Requirements

There is **no feature flag** to bypass service-area enforcement (`ENABLE_SERVICE_AREA_CHECK` was an imaginary feature flag; service area enforcement is mandatory and unconditional).

Production deployments must execute the following 8-step sequence:

1. **PostGIS Provisioning:** Provision a PostgreSQL 15+ database instance with the PostGIS extension enabled (`CREATE EXTENSION IF NOT EXISTS postgis;`).
2. **Core Migrations:** Apply base schema migrations `001_initial_schema.sql` through `004_route_indexes.sql`.
3. **Service-Area Migration:** Execute `infra/migrations/005_service_areas.sql` to establish the `service_areas` table, insert the authoritative Delhi NCR dissolved boundary geometry, and verify polygon topology and area constraints.
4. **Migration Verification:** Query PostgreSQL to confirm boundary validity:
   ```sql
   SELECT region_id, region_name, boundary_version, ST_IsValid(geometry) AS is_valid, ST_Area(geometry::geography) / 1000000.0 AS area_sq_km
   FROM service_areas WHERE is_active = TRUE;
   ```
   Assert `is_valid = true` and `area_sq_km` between 54,000 and 57,000.
5. **Backend Deployment:** Deploy the `@floodrelay/api` container with `DATABASE_URL` configured. On startup, the service verifies the SHA-256 integrity of `services/api/src/geo/delhi-ncr-boundary.geojson` against `DELHI_NCR_EXPECTED_DATASET_SHA256`.
6. **Health & Endpoint Check:** Execute `GET /health` and `POST /requests/service-area-check` with known test coordinates (e.g. Connaught Place `28.6315, 77.2167`) to verify 200 OK response with `status: "INSIDE"`.
7. **Frontend Deployment:** Deploy the `@floodrelay/web` Next.js frontend with `NEXT_PUBLIC_API_URL` pointing to the API service.
8. **Traffic Enablement:** Direct ingress load balancers / reverse proxies to route public citizen and operator traffic to the updated deployment.
