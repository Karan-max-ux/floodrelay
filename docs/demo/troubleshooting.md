# FloodRelay Demonstration System — Troubleshooting Guide

This guide details common issues encountered when setting up and running the demonstration environment, along with rapid resolution steps.

---

## 1. Database Connection & Authentication Failures

### Issue: `password authentication failed for user "floodrelay"` (Code: `28P01`)

**Cause:** A local PostgreSQL instance running natively on Windows port 5432 with different credentials is intercepting connections intended for the Docker PostGIS container.

**Resolution:**

1. Check running Windows PostgreSQL services:
   ```powershell
   Get-Service *postgres*
   ```
2. If native PostgreSQL is running on port 5432:
   - Either start the project PostGIS container on a dedicated alternate port (e.g. `POSTGRES_PORT=5433` in `.env` and `DATABASE_URL=postgresql://floodrelay:floodrelay_dev@localhost:5433/floodrelay`), OR
   - Stop the native Windows service temporarily:
     ```powershell
     Stop-Service postgresql-x64-18
     ```
   - Then start the official PostGIS container:
     ```powershell
     docker-compose -f infra/docker-compose.yml up -d
     ```
3. Verify connection:
   ```powershell
   npm run demo:setup
   ```

---

## 2. Port Binding Conflicts

### Issue: Port 3000 or 5432 Already in Use

**Symptoms:** `listen EADDRINUSE: address already in use :::3000`

**Resolution:**

1. Find which process is holding port 3000 or 5432:
   ```powershell
   Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
   ```
2. Terminate the blocking process:
   ```powershell
   Stop-Process -Id <ProcessId> -Force
   ```
3. Alternatively, launch the API on an alternate port:
   ```powershell
   $env:PORT=3001; npm run dev --workspace=@floodrelay/api
   ```

---

## 3. Database Safety Guard Failures

### Issue: `UNAUTHORIZED_DEMO_DATABASE_NAME` or `UNAUTHORIZED_DEMO_EXECUTION`

**Cause:** The demo setup script enforces strict database safety guards to prevent accidental deletion or mutation of development or production databases (`assertDisposableDemoDatabase`).

**Resolution:**

- Verify that `NODE_ENV` is NOT set to `production`.
- Verify that `ALLOW_DISPOSABLE_DEMO_DB=1` is explicitly defined in your `.env` file.
- Verify that the target database name in `DATABASE_URL` is strictly `floodrelay_demo` or `floodrelay_test` on `localhost` / `127.0.0.1`.
- Example valid `.env` configuration:
  ```env
  ALLOW_DISPOSABLE_DEMO_DB=1
  DATABASE_URL=postgresql://floodrelay:floodrelay_dev@localhost:5432/floodrelay_demo
  ```

---

## 4. Open-Meteo Upstream River Forecast Unavailable

### Issue: Network timeout or air-gapped evaluation environment

**Cause:** Evaluation workstation lacks outbound Internet access to reach Open-Meteo Flood API (`https://flood-api.open-meteo.com/v1/flood`).

**Behavior:**

- When live network connectivity to Open-Meteo is unavailable:
  - If a cached forecast exists, FloodRelay serves it with `"freshness": "STALE"` and an explanatory notice.
  - If `FORECAST_ENABLE_OFFLINE_FIXTURE=1` is set, FloodRelay serves an offline deterministic GloFAS fixture modeled for the Yamuna reach with `"freshness": "OFFLINE_FIXTURE"`.
  - Otherwise, the endpoint gracefully degrades to `"freshness": "UNAVAILABLE"`, `"riskCategory": "UNAVAILABLE"`, and `daily: []`, without fabricating normal river discharge or triggering false flood alarms.
- The UI hook (`useFloodForecast`) surfaces explicit `STALE`, `OFFLINE_FIXTURE`, or `UNAVAILABLE` badges without failing or blocking rescue operations.

---

## 5. Frozen Stops Not Preserved Error

### Issue: `SAFETY VIOLATION: Repair violated committed frozen stops`

**Cause:** Injected repair solver produced a route mutation that altered a stop where `is_frozen = true`.

**Resolution:**

- Inspect `services/api/src/services/repairOrchestrationService.ts`.
- Ensure `baselineAssignmentId` is passed to the repair call so that committed stops are locked.
- Run automated verification:
  ```powershell
  npx vitest run services/api/src/demoWorkflow.test.ts
  ```
