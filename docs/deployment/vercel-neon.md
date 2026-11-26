# FloodRelay Deployment Guide — Vercel Hobby & Neon Free

> [!IMPORTANT]
> **Non-Production Demonstration Environment Only**
> This guide configures a **non-production demonstration deployment** on Vercel Hobby (free) and Neon Free. It is intended solely for demonstration, evaluation, and review — not for live emergency dispatch or life-safety operations.

---

## Architecture Overview

FloodRelay deploys as **two separate Vercel projects** backed by a single **Neon PostgreSQL + PostGIS** database in Singapore (`sin1` / `ap-southeast-1`):

1. **Backend API Project (Express + TypeScript + `@floodrelay/solver`)**
   - **Vercel Root Directory:** Repository root (`.`)
   - **Entrypoint:** `server.ts` -> `services/api/src/vercel.ts`
   - **Configuration:** `vercel.json` (`"framework": "express"`, `"regions": ["sin1"]`, Node.js `24.x` via `package.json`)
   - Bundled runtime files: `services/api/src/openapi.json` and `services/api/src/geo/delhi-ncr-boundary.geojson`

2. **Frontend Web Project (Next.js 15)**
   - **Vercel Root Directory:** `apps/web`
   - **Monorepo Access:** Enable **"Include source files outside the Root Directory"** (so `apps/web/next.config.mjs` can transpile `@floodrelay/shared` and trace from `outputFileTracingRoot`)
   - Proxies API requests server-side via Next.js `rewrites()` using `BACKEND_API_URL`

---

## 1. Provision Neon PostgreSQL + PostGIS (Singapore)

1. Create a Neon project in the **Singapore (`aws-ap-southeast-1`)** region so it sits adjacent to Vercel's `sin1` functions.
2. Neon provides two connection strings:
   - **Pooled connection string** (hostname includes `-pooler`, uses PgBouncer): use for **runtime** API traffic (`DATABASE_URL` in Vercel).
   - **Direct (unpooled) connection string** (no `-pooler`): use for **schema migrations** and CLI administrative tasks.
3. Run database migrations **once, separately from API startup** (serverless startup intentionally does **not** run migrations):

```bash
DATABASE_URL="postgresql://<user>:<password>@<direct-host>/<db>?sslmode=require" \
  npm run migrate --workspace=@floodrelay/api
```

> [!NOTE]
> The migrations enable PostGIS and load the canonical Delhi NCR `service_areas` boundary. The API validates this boundary on cold start via `attestActiveBoundaryIntegrity()`.

### Optional: Seed Simulated Yamuna Scenario

To populate the demonstration with the simulated Yamuna scenario (`SIMULATED` provenance preserved on all seeded entities):

```bash
DATABASE_URL="postgresql://<user>:<password>@<direct-host>/<db>?sslmode=require" \
  npm run seed --workspace=@floodrelay/api -- --file scenarios/demo-yamuna-scenario.json
```

> [!WARNING]
> **Do NOT use `tools/demo/setupDemo.ts` against Neon.**
> `tools/demo/setupDemo.ts` (and `npm run demo:setup`) enforces a disposable-database host guard (`STRICT_ALLOWED_DEMO_HOSTS`) that intentionally rejects remote database hosts to prevent accidentally wiping or mutating non-local databases.

---

## 2. Deploy the Backend API on Vercel

1. Import the repository into Vercel as a new project (**API project**).
2. Set **Root Directory** to the **repository root** (`.` / empty).
3. Verify **Node.js Version** is `24.x` (pinned via `package.json` `"engines": { "node": "24.x" }`).
4. Configure the following **Environment Variables** in Vercel for the API project:

| Variable                    | Required    | Value / Guidance                                                                                                     |
| --------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`              | Yes         | **Neon pooled** connection string (`...-pooler...neon.tech/...?sslmode=require`)                                     |
| `REQUIRE_DB`                | Yes         | `1` (fail closed if database connectivity or boundary attestation fails)                                             |
| `CORS_ORIGIN`               | Yes         | Origin URL of the deployed frontend (e.g. `https://floodrelay-web.vercel.app`) — comma-separated if multiple         |
| `INITIAL_OPERATOR_USERNAME` | Yes         | Initial admin operator username (e.g. `demo_admin`)                                                                  |
| `INITIAL_OPERATOR_PASSWORD` | Yes         | High-entropy unique password (do **not** use the local dev default `RescueOps@2026!`; production startup blocks it)  |
| `INITIAL_OPERATOR_NAME`     | Yes         | Display name for the initial operator (e.g. `EOC Duty Commander`)                                                    |
| `PG_POOL_MAX`               | Recommended | `3` (defaults to `3` per Vercel serverless instance when unset on Vercel; keeps Neon Free connections within limits) |

5. Deploy the API project and verify `GET https://<your-api-domain>.vercel.app/health` returns `200 OK`.

---

## 3. Deploy the Frontend on Vercel

1. Import the same repository into Vercel as a second project (**Frontend project**).
2. Set **Root Directory** to `apps/web`.
3. Under **Project Settings -> Build and Deployment**, enable **"Include source files outside the Root Directory"** (access to source files outside `apps/web` is required for `@floodrelay/shared` and `outputFileTracingRoot`).
4. Verify **Node.js Version** is `24.x`.
5. Configure the following **Environment Variables** in Vercel for the Frontend project:

| Variable              | Required            | Value / Guidance                                                                                                      |
| --------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `BACKEND_API_URL`     | Yes                 | Base URL of the deployed Vercel API project without a trailing slash (e.g. `https://floodrelay-api.vercel.app`)       |
| `NEXT_PUBLIC_API_URL` | **Must stay unset** | Leave unset so browser API calls stay same-origin and route through Next.js server-side rewrites to `BACKEND_API_URL` |
| `GEOAPIFY_API_KEY`    | Optional            | Server-side key for Citizen Portal GPS address autofill (falls back to Nominatim if unset)                            |

6. Deploy the Frontend project.
7. Once the final frontend domain (and any custom domain) is known, confirm `CORS_ORIGIN` on the **API project** matches it exactly and redeploy the API if updated.

---

## 4. Solver & Routing Notes (No OSRM / No Separate Solver Service)

- Keep **OSRM disabled initially** (`OSRM_BASE_URL` and `OSRM_REGIONS` left unset). Do **not** deploy a separate solver microservice; `@floodrelay/solver` runs in-process inside the API serverless function.
- When OSRM is not configured, the solver uses **straight-line travel-time fallback estimates** (`STRAIGHT_LINE`).
- **Straight-line solver fallback estimates are not road navigation**: they measure geodesic distances adjusted by average vehicle speed and do not account for turn restrictions, road geometry, bridge closures, or live traffic outside explicitly recorded blocked-road zones.
- If live reverse-geocoding or OSRM is later enabled, add only server-side configuration and verify Hobby function duration budgets.
