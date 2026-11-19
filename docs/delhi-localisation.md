# FloodRelay — Delhi NCR Localisation & Geographic Integration

FloodRelay defaults its **user-facing experience** to **Delhi NCR** and **Indian English (`en-IN`)** with **Indian Standard Time (`Asia/Kolkata` / IST)** display formatting. Centralised region defaults live in `apps/web/lib/region.ts`, and citizen-critical translation keys live in `apps/web/lib/i18n/`.

> **Prototype Boundary:** Localised UI copy, native Delhi reference datasets, and passing automated tests do **not** make FloodRelay production-ready for live emergency dispatch. FloodRelay remains a human-supervised decision-support prototype.

---

## 1. Completed Delhi NCR & Indian English Localisation (`en-IN`)

- **Regional Defaults (`apps/web/lib/region.ts`):**
  - `code`: `IN-DL`, `label`: `Delhi NCR`, `floodplain`: `Delhi–Yamuna Floodplain`
  - `locale`: `en-IN`, `timeZone`: `Asia/Kolkata`, `emergencyNumber`: `112`
  - `defaultMapCentre`: `{ lat: 28.6139, lng: 77.209 }` (central Delhi NCR)
  - `tacticalDemoCentre`: `{ lat: 28.671, lng: 77.234 }` (North Delhi / Yamuna Floodplain tactical demonstration centre, zoom `12`)
- **Timestamp Presentation vs Storage:**
  - All API contracts, solver inputs, and PostgreSQL/PostGIS timestamps remain ISO 8601 UTC.
  - Citizen receipts, operator request tables, assignments, audit logs, operational event feeds, and map inspector drawers display timestamps deterministically in IST via `formatRegionDate`, `formatRegionTime`, and `formatRegionDateTime`.
- **UI Examples & Copy:**
  - Citizen and Operator portals use Delhi NCR placeholders (e.g., `Civil Lines`, `Old Railway Bridge`, `28.6710`, `77.2340`) and Indian English phrasing (`authorised`, `colour`, `neighbourhood`, `prioritises`, `enquiry`).
  - Citizen Portal Step 2 (`Triage & Review`) displays `Operator review workflow` and makes no claim that live citizen request tracking is currently available.
  - Confirmation receipts display `FLOODRELAY REQUEST RECEIPT` (not an official government receipt) and do not promise physical rescue deployment.

---

## 2. Native Delhi Synthetic Reference Geometry

Runtime Houston-to-Delhi coordinate rebasing (`HOUSTON_ANCHOR`, `rebaseLatLng`) has been removed from the active map and repair fixtures:

- **`scenarios/sample-scenario.json` (`scenario-delhi-yamuna-demo`):**
  - Contains **5 simulated rescue requests** (`req-001`–`req-005`), **3 simulated resources** (`res-boat-01`, `res-boat-02`, `res-truck-01`), **2 simulated relief camps** (`shelter-kashmere-gate`, `shelter-wazirabad`), and **1 simulated blocked hazard zone** (`zone-old-railway-bridge`) within `lat [28.60, 28.75]`, `lng [77.18, 77.28]`.
  - Every request, resource, and shelter carries explicit `"source": "SIMULATED"` provenance.
- **`apps/web/lib/fixtures/mapReferenceData.ts`:**
  - Mirrors `scenarios/sample-scenario.json` directly for the Operator GIS Tactical Map reference layers and derives `TACTICAL_MAP_DEFAULT_CENTRE` from `REGION_CONFIG`.
- **`apps/web/lib/fixtures/repairFixtures.ts`:**
  - Defines native North Delhi / Yamuna Floodplain repair evaluation plans (`delhi-yamuna-north-baseline` and `delhi-yamuna-north-repaired`) referencing `res-boat-01`, `res-boat-02`, `res-truck-01`, `shelter-kashmere-gate`, `shelter-wazirabad`, and `DELHI_REPAIR_SCENARIO_REQUESTS` (`req-001`–`req-005`, `req-delhi-repair-006`, `req-delhi-repair-007`).
  - Strictly read-only preview fixtures; database commitment is disabled in UI and enforced server-side.

---

## 3. Real vs Simulated Asset Separation & Agency Non-Affiliation

- **Authoritative Database vs Reference Map Layers:**
  - The Operator Overview fleet roster (`ResourceStatusPanel`) reads authoritative PostgreSQL fleet inventory (`GET /operations/resources`) and blocks mutations on `SIMULATED` records.
  - The GIS Tactical Map displays live database distress incidents (`REAL / REPORTED` or `SIMULATED`) and backend-supplied assignment routes verbatim at their actual WGS84 coordinates (including coordinates outside Delhi NCR).
  - Reference fleet markers, shelters, and blocked zones are visibly badged `SIMULATED` across map popups, the legend (`Map & Route Key`), and `MapInspectorDrawer`.
- **No Official Agency Affiliation:**
  - Fictional demo vessels (`Simulated Rescue Boat Alpha (Demo — Not Official NDRF)`, `Simulated Rescue Boat Bravo (Demo — Not Official NDRF)`) are explicitly labelled demonstration-only and do not represent official NDRF, DDMA, or government assets.
- **Provenance Safety Guardrails (PR #41):**
  - Server-side `commitAssignment()` continues to reject simulated resources (`SIMULATED_RESOURCE_FORBIDDEN`), simulated requests (`SIMULATED_REQUEST_FORBIDDEN`), and simulated shelters (`SIMULATED_SHELTER_FORBIDDEN`) in operational plans.

---

## 4. Geocoding Pipeline & Limitations

Citizen location intake (`apps/web/lib/geocoding.ts`, `apps/web/hooks/useCitizenLocation.ts`, `/api/geocode`, `/api/reverse-geocode`) follows a strict fallback hierarchy:

1. **Primary Lookup:** Geoapify forward/reverse geocoding (when `GEOAPIFY_API_KEY` is configured).
2. **OpenStreetMap Nominatim Fallback:** Policy-compliant HTTPS client with descriptive `User-Agent`, 1 req/sec in-memory request serializer, single-flight deduplication, 1-hour bounded LRU cache (max 500 entries), allowlisted host validation, and OpenStreetMap attribution.
3. **Bounded Regional Landmark Fallback:** Within the Delhi NCR reference coverage box (`lat 28.44–28.74`, `lng 76.98–77.50`) and strictly within `5.0 km`, falls back to an explicitly labelled `(Approximate Landmark)` description.
4. **Graceful Manual Entry:** When all lookup providers are unavailable or coordinates fall outside coverage, citizens can still enter an address/landmark and confirm coordinates manually.

**Non-negotiable geocoding invariants:**

- Citizen-provided GPS or manual coordinates are **never replaced** by an approximate landmark's coordinates.
- Geocoding and reverse-geocoding lookup endpoints accept any valid WGS84 coordinates without throwing runtime crashes or internal errors.
- However, final rescue request submission (`POST /requests`) strictly enforces the authoritative Delhi NCR service area boundary (`docs/service-area.md`); coordinates outside the NCR boundary are rejected with HTTP 422 `OUTSIDE_SERVICE_AREA` and zero database writes.
- In horizontally scaled multi-instance or serverless deployments, process-local Nominatim caching/rate-limiting does not provide a global distributed rate limit; deploy a dedicated Nominatim gateway or commercial API key for multi-instance production use.

---

## 5. Authoritative Delhi NCR Service-Area Boundary & Intake Enforcement

FloodRelay restricts rescue assistance intake to the official **National Capital Region (NCR)**:

- **Authoritative Extent:** Encompasses all 34 constituent administrative districts (~55,083 sq. km) across the NCT of Delhi (11 districts), Haryana (14 districts), Uttar Pradesh (8 districts), and Rajasthan (2 districts). See [docs/service-area.md](service-area.md) for full provenance, GeoJSON checksums, and dataset details.
- **PostGIS Enforcement:** Spatial containment is evaluated in PostgreSQL via `ST_Covers(geometry, ST_SetSRID(ST_MakePoint(lng, lat), 4326))` using an indexed `GEOMETRY(MultiPolygon, 4326)` table (`service_areas`).
- **Outside-Area Intake Contract:** Out-of-NCR submissions are rejected with HTTP 422 `OUTSIDE_SERVICE_AREA` before any request, operational event, or audit record is created.
- **Near-Boundary Handling (1,000 m):** Coordinates within 1,000 m outside the boundary are detected via metric distance calculation, rejected at server-side (zero DB writes), and presented with focused boundary guidance directing citizens to verify address or call 112.
- **Fail-Closed Availability:** If the service-area boundary dataset is missing or unverified, requests fail closed with HTTP 503 `SERVICE_AREA_UNAVAILABLE` without exposing database internals.
- **Citizen Guidance:** The Citizen Portal immediately displays clear emergency guidance directing citizens in immediate danger to **Call 112** (`tel:112`), provides options to change location or retry, and never displays a fake confirmation ticket.
- **Confirmation Page Guard:** Protects against stale `sessionStorage` receipts being presented as confirmation of newly rejected submissions.

---

## 6. Emergency Numbers & Unverified Real-World Data

| Category                                                           | Status                          | Source / Policy                                                                                                                                                                        |
| ------------------------------------------------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **National Emergency Helpline (`112`)**                            | **Verified**                    | Emergency Response Support System (ERSS), Ministry of Home Affairs, Government of India (`https://www.mha.gov.in/emergency-response-support-system-erss`; verified 2026-11-18).        |
| **District / Local Helplines (e.g. DDMA / Flood Control numbers)** | **Omitted**                     | Not published in UI without authoritative source attribution and periodic verification workflow.                                                                                       |
| **Live Relief Shelters & Bed Availability**                        | **Unverified / Simulated Only** | Map shelter markers (`Kashmere Gate Relief Camp`, `Wazirabad Community Relief Centre`) are labelled `SIMULATED • Unverified Reference` and never claim live `Open` operational status. |
| **Live Yamuna Water-Level / River-Gauge Feed**                     | **Not Integrated**              | Citizen status bar explicitly states `No live water-level feed`. No fabricated flood-extent polygons or synthetic live gauge readings are displayed.                                   |

---

## 7. Hindi (`hi-IN`) Localisation Status

- **Architecture Ready (`apps/web/lib/i18n/`):**
  - Typed `CitizenMessages` keys cover citizen-critical domains: `home`, `request`, `validation`, `emergency`, and `confirmation`.
  - `EN_IN_MESSAGES` (`en-IN`) is active and verified as `DEFAULT_LOCALE`.
  - `HI_IN_MESSAGES_DRAFT` (`hi-IN`) is scaffolded with `reviewStatus: 'PENDING_HUMAN_REVIEW'` and **`enabled: false`**. `resolveActiveLocale('hi-IN')` safely resolves to `'en-IN'`.
- **Remaining Task Before Enabling Hindi Selector:**
  - Engage a qualified native Hindi reviewer/disaster-communications specialist to author and review all keys in `apps/web/lib/i18n/hi-IN.ts` (especially life-safety `112` emergency notices, non-deployment disclaimers, form validation errors, and receipt wording), followed by automated and manual UI QA in `hi-IN`.
  - Machine-generated translations must **not** be enabled for safety-critical citizen workflows without human review.
