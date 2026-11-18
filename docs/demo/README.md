# FloodRelay Demonstration System (Phase 6)

## 1. Overview

FloodRelay is an operational decision-support platform designed for disaster response coordinators managing flood evacuations along urban river corridors (demonstrated along the Yamuna River basin in North Delhi).

The demonstration system provides a deterministic, reproducible, end-to-end environment demonstrating:

1. **Public Citizen Intake:** Fast distress request submission with automatic geospatial duplicate flagging.
2. **Human-in-the-Loop Dispatch:** Algorithmic optimization proposing fleet routes without autonomous commitment.
3. **Operational Disruption Management:** Real-time handling of craft breakdowns and submerged roads.
4. **Frozen-Stop Incremental Repair:** Route re-optimization that strictly preserves ongoing, committed in-flight rescue missions (`is_frozen = true`).
5. **GIS Forecast Context Layer:** Informational GloFAS river discharge context layer integrated into the tactical Leaflet map.
6. **Immutable Operational Audit Trail:** Complete tamper-evident record of all operational mutations and decisions.

---

## 2. Quickstart Commands

### Prerequisites

- **Node.js:** v24.x LTS or higher (`node -v`)
- **PostgreSQL / PostGIS:** PostgreSQL 16+ with PostGIS 3.4+ extension enabled
  - Start via Docker Compose: `docker-compose -f infra/docker-compose.yml up -d`
- **Dependencies:** Installed via `npm ci`

### Running the Demonstration Setup

To seed the database, provision the demonstration operator, establish the baseline rescue proposal in **Simulation Preview Mode** (retaining synthetic entities in `PROPOSED` status per PR #41 operational provenance rules), and inject disruption events for incremental repair evaluation:

```powershell
npm run demo:setup
```

### Simulation Preview vs. Operational Commitment

FloodRelay strictly separates synthetic demonstration scenarios from live operational dispatch:

- **Simulation Preview Mode (Demo CLI):**
  - Evaluates synthetic requests, rescue resources, and shelters labeled `source: 'SIMULATED'`.
  - Proposals remain in `PROPOSED` status (`frozenStopsCount: 0`).
  - PR #41 strictly prevents committing synthetic entities to operational dispatch (`SIMULATED_REQUEST_FORBIDDEN` / `SIMULATED_RESOURCE_FORBIDDEN`).
  - Evaluators observe route optimization, simulated disruptions, and incremental repair without altering live operational state or fabricating fake in-flight rescues.

- **Operational Dispatch (Real Disaster Response / Integration Tests):**
  - Operates on verified citizen requests (`source: 'REPORTED'`) and registered fleet assets (`source: 'REAL'`).
  - An authorized human dispatcher explicitly commits the deployment plan via `POST /assignments/:id/commit`.
  - In-flight mission stops are locked (`is_frozen = true`).
  - Incremental repair guarantees zero churn violations on frozen stops (`churn.frozenStopsViolated = 0`).

### Forecast Freshness & Provenance Guarantees

The hydrological forecast context layer (`GET /forecast/context`) enforces strict scientific provenance:

- `FRESH`: Authentic, newly retrieved data from Copernicus EMS GloFAS 4.0 via Open-Meteo.
- `CACHED`: Authentic forecast served from the in-memory cache within TTL.
- `STALE`: Authentic previously cached forecast served with an explicit notice when the upstream provider experiences a temporary outage.
- `UNAVAILABLE`: Returned when the upstream provider is unreachable and no authentic cache exists. Never fabricates low or normal river levels.
- `OFFLINE_FIXTURE`: Deterministic synthetic fixture (`source: 'SIMULATED FORECAST — DEMO ONLY'`, `riskCategory: 'UNKNOWN'`) served **ONLY** when `FORECAST_ENABLE_OFFLINE_FIXTURE=1` is explicitly set in non-production. Offline fixtures are isolated from the authentic forecast cache and can never be promoted to `CACHED` or `READY`.

### Dependency Security Audit Scope

- **Production Dependencies (`npm audit --omit=dev --audit-level=high`):** 0 vulnerabilities. Verified in CI.
- **Development Tooling (`npm audit`):** 21 vulnerabilities (8 moderate, 13 high) isolated to build/test tools (`minimatch` in ESLint, `picomatch` in Vitest/Tailwind). These tools are not bundled or reachable in production runtime environments.

### Running the Web Applications

Start the backend API and Next.js frontend:

```powershell
# In terminal 1 (Express API service listening on port 3001):
$env:PORT=3001; npm run dev --workspace=@floodrelay/api

# In terminal 2 (Next.js Operator & Citizen Portal on port 3000, proxying API to port 3001):
npm run dev --workspace=@floodrelay/web
```

### Interactive Demonstration Portals

All interactive portals and proxied API endpoints are accessible through Next.js on port 3000:

- **Citizen Distress Submission:** [http://localhost:3000/citizen/request](http://localhost:3000/citizen/request)
- **Operator Command Portal:** [http://localhost:3000/operator](http://localhost:3000/operator)
- **Tactical GIS Live Map:** [http://localhost:3000/operator/map](http://localhost:3000/operator/map)
- **Operational Audit Log:** [http://localhost:3000/operator/audit](http://localhost:3000/operator/audit)
- **Platform Limitations & Boundary Disclaimers:** [http://localhost:3000/limitations](http://localhost:3000/limitations)
- **River Forecast Context API (Proxied):** [http://localhost:3000/forecast/context](http://localhost:3000/forecast/context)

### Demonstration Operator Credentials

The demo setup generates a cryptographically strong, non-deterministic password saved locally to `.demo-credentials.local.json` (gitignored). To display the credentials:

```powershell
npm run demo:credentials
```

- **Username:** `demo_operator`
- **Role:** `DISPATCHER` (Least-privilege role sufficient for distress triage, routing, and repair)
- **Password:** Protected in `.demo-credentials.local.json`

### Cleaning Demonstration Artifacts

To safely remove all demonstration data without touching other database records:

```powershell
npm run demo:cleanup
```

---

## 3. Demonstration Architecture

```text
┌────────────────────────────────────────────────────────┐
│                  Next.js Web Frontend                  │
│   Citizen Portal  │  Operator Portal  │  Tactical Map  │
└───────────────────────────┬────────────────────────────┘
                            │ HTTP / REST
┌───────────────────────────▼────────────────────────────┐
│                    Express API Core                    │
│  RBAC Auth  │  Intake Service  │  Repair Orchestrator  │
└──────┬────────────────────┬────────────────────┬───────┘
       │                    │                    │
┌──────▼───────┐     ┌──────▼───────┐     ┌──────▼───────┐
│ PostGIS Data │     │ Incremental  │     │ GloFAS Flood │
│ Spatial Repos│     │ Pure Solvers │     │ Context API  │
└──────────────┘     └──────────────┘     └──────────────┘
```

For a detailed step-by-step demonstration walkthrough, see [walkthrough.md](./walkthrough.md).  
For troubleshooting instructions, see [troubleshooting.md](./troubleshooting.md).  
For a 5–10 minute faculty evaluation script, see [presentation-script.md](./presentation-script.md).
