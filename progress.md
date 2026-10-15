# Flood Rescue Resource Allocation Platform — Progress

**Last updated:** 2026-10-15

**Current focus:** Phase 0 — Project setup

Status legend: ⬜ not started · 🟡 in progress · ✅ done

---

## 1. What we are building

Citizens (or helpers) submit rescue requests with location, number of people and urgency. The system validates and de-duplicates requests, groups nearby demand into clusters, estimates travel costs using the road network, and proposes assignments of resources to requests under capacity and availability constraints. Operators see assignments, unserved requests and the reasons on a live map, and commit or change them. When a new request arrives or a resource changes status, only the affected assignments are recalculated instead of rebuilding everything.

---

## 2. University requirements

- Next.js and React.js are compulsory.
- All other technologies are the team's choice.
- The project will be evaluated by faculty and is also meant to be real-world usable and portfolio-grade.

---

## 3. Principles

- No machine learning unless a measured need appears. Reliable algorithms are preferred.
- Real geographic data (OpenStreetMap roads, real forecast layers). Simulated rescue requests are always labelled `SIMULATED` and generated from a seeded, reproducible script.
- Every number shown must be real API data with a source and timestamp, user input, or the output of a deterministic algorithm. Never LLM-generated.
- Honest uncertainty: show stale or low-accuracy locations, show travel times as ranges, mark road status as known blocked / known open / unknown.
- Build the working, testable allocation workflow first. Add infrastructure (queue, real-time, routing server) only when a measurement or a feature needs it.
- Decision support only: a human operator commits assignments.

---

## 4. Tech stack

| Layer | Choice | Why | Status |
|---|---|---|---|
| Frontend (mandatory) | Next.js (App Router) + React + TypeScript | Citizen request form, operator dashboard, field-team view | Planned |
| Map | react-leaflet loaded with dynamic import and SSR disabled | Leaflet needs the browser `window` object | Planned |
| Backend | Separate Node.js service, Express + TypeScript (strict mode) | Intake, assignment, auth, live updates | Planned |
| Database | PostgreSQL + PostGIS | Spatial queries and a built-in DBSCAN to verify our own clustering | Planned |
| Queue and pub/sub | Redis (BullMQ) | Added only if measurements show the solver must run outside the request cycle | Planned |
| Routing | OSRM in Docker | Travel-time matrix from OpenStreetMap data | Planned |
| Live updates | Polling first, Socket.IO when the dashboard needs it | — | Planned |
| Deployment | docker-compose for the backend stack, frontend on any Next.js host | — | Planned |
| Testing and CI | Jest/Supertest, k6 for load tests, GitHub Actions | — | Planned |

---

## 5. Architecture

**Flow:**

```
Incoming rescue requests
  → Validation (timestamps, verification status, duplicate detection)
  → PostGIS storage + DBSCAN demand clustering
  → Travel-time provider (straight-line first, OSRM later) + allocation optimizer
  → Operator dashboard (assignments, unserved requests, reasons, status updates)
```

**Design notes:**

- The solver is a standalone library in `packages/solver` that takes a scenario and returns assignments, with no database, HTTP or UI dependency.
- Travel time sits behind a `TravelTimeProvider` interface (straight-line times a detour factor first, OSRM version later).
- DBSCAN noise points are treated as their own demand units and are never dropped.
- Coordinates are projected to a metric system before clustering so the distance parameter is in metres.
- Unverified requests are shown with a flag or lower weight, never silently discarded.
- The solver proposes; an operator commits. Committed or dispatched stops are frozen and not reshuffled by re-optimization.
- Next.js middleware only hides pages; real authorization is enforced in the backend.

---

## 6. Incremental update strategy

| Event | Handling |
|---|---|
| New request | Insert into best route |
| Resource goes offline | Unassign its pending stops and re-insert, then local repair |
| Request cancelled or duplicate | Remove from route |
| Road newly blocked | Re-cost and repair only affected routes |
| Periodic or drift-triggered background | Full re-optimization applied only to non-frozen stops |

**Benchmark three strategies:**

1. Full re-solve on every event
2. Insertion plus periodic re-optimization
3. Event-triggered local repair

---

## 7. Evaluation plan

- **Metrics** (fixed before solver code is written):
  - Coverage (percent of requests served)
  - Total travel time
  - Wait time for high-priority requests
  - Solve time
  - Latency per event (p50 and p95)
  - Assignment churn (how many already-communicated assignments change per event)
- **Baselines:** nearest-first greedy and Google OR-Tools.
- At least 20 random seeds per scenario size, report mean and spread.
- Scenario sizes to include a 500-requests / 30-resources case.
- Results table is generated by a committed script and run in CI.
- **All results currently:** TBD (to be measured).

---

## 8. Phases (ordered, not scheduled)

### Phase 0 — Project setup

| Task | Owner | Status |
|---|---|---|
| Root README.md | — | ✅ |
| .gitignore | — | ✅ |
| .env.example | — | ✅ |
| docs/decisions.md | — | ✅ |
| Conventions (branch naming, commits, PR process) | — | ✅ |
| GitHub branch protection rule on main | — | ⬜ |
| Folder structure | — | ✅ |
| Workspace tooling (root package.json, tsconfig, lint configs) | — | ⬜ |
| docker-compose for Postgres/PostGIS | — | ✅ |
| CI skeleton | — | ✅ |
| Agree on backend framework | — | ✅ |

### Phase 1 — Solver core and evaluation harness

| Task | Owner | Status |
|---|---|---|
| Scenario format | — | ⬜ |
| Seeded generator | — | ⬜ |
| Metrics | — | ⬜ |
| Nearest-first baseline | — | ⬜ |
| Own DBSCAN | — | ⬜ |
| First allocation heuristic with straight-line distances behind TravelTimeProvider | — | ⬜ |
| OR-Tools baseline | — | ⬜ |
| Results-table script | — | ⬜ |

### Phase 2 — API and database

| Task | Owner | Status |
|---|---|---|
| Schema | — | ⬜ |
| Request intake with idempotency and duplicate detection | — | ⬜ |
| PostGIS storage | — | ⬜ |
| Assignment endpoints | — | ⬜ |
| OpenAPI spec | — | ⬜ |

### Phase 3 — Frontend

| Task | Owner | Status |
|---|---|---|
| Citizen request form | — | ⬜ |
| Operator map and assignment view | — | ⬜ |
| Built against saved solver output (fixtures) first | — | ⬜ |

### Phase 4 — Road network and uncertainty

| Task | Owner | Status |
|---|---|---|
| OSRM travel times (check the OSRM docs for the table request size limit) | — | ⬜ |
| Operator-marked blocked areas | — | ⬜ |
| Uncertainty features | — | ⬜ |
| Perturbation re-runs to report how often assignments change | — | ⬜ |

### Phase 5 — Incremental updates and live operations

| Task | Owner | Status |
|---|---|---|
| Event handlers | — | ⬜ |
| Local repair | — | ⬜ |
| Frozen committed stops | — | ⬜ |
| Churn metric | — | ⬜ |
| Live dashboard updates | — | ⬜ |
| Roles | — | ⬜ |
| Audit log | — | ⬜ |

### Phase 6 — Hardening and documentation

| Task | Owner | Status |
|---|---|---|
| Redis queue only if measurements justify it | — | ⬜ |
| Optional flood-forecast context layer | — | ⬜ |
| Load tests | — | ⬜ |
| CI | — | ⬜ |
| Limitations page | — | ⬜ |
| Demo script | — | ⬜ |

---

## 9. Current status

- **Last completed:** Backend framework decided (Express + TypeScript).
- **Next up:** GitHub branch protection rule on main, and workspace tooling (root package.json, tsconfig, lint configs) to finish Phase 0, then begin Phase 1.
- Phase 0 open items: GitHub branch protection rule on main, workspace tooling.
- Everything in Phase 1 and beyond: not started.

---

## 10. Team

| Member | Role | Current task |
|---|---|---|
| | | |
| | | |
| | | |
| | | |

> **Suggested roles:** backend, geo/algorithms, frontend/map, DevOps/quality/docs.

---

## 11. Decisions made

| Decision | Reason |
|---|---|
| Next.js + React frontend | University requirement |
| Separate Node.js backend | Long-running work and live updates do not fit serverless; stronger backend story |
| PostgreSQL + PostGIS | Spatial queries, built-in DBSCAN for verification |
| No machine learning | Reliable deterministic algorithms preferred; no measured need for ML |
| Build solver and evaluation before infrastructure | Validate the core logic before adding queues, real-time layers, etc. |
| Operator commits assignments | Decision support only; the system never dispatches autonomously |
| Backend framework: Express with TypeScript | Team knows Express, setup is minimal, effort goes to the solver; TypeScript strict mode shared across all packages catches field mismatches at compile time; framework can be changed later because the solver has no framework dependency |

---

## 12. Open questions

- [ ] Confirm with faculty that a separate Node backend is acceptable alongside the mandatory Next.js and React.
- [ ] Which district or river basin do we use for scenarios?
- [ ] Who owns each role above?
- [ ] How will boats be modelled, given OSRM has no boat profile?

---

## 13. Known limitations

- Demo rescue requests are simulated.
- OSRM uses static map data, so it does not know which roads are flooded; operators mark blocked areas and routes crossing them are flagged.
- No live traffic.
- Results are from simulated scenarios and are not field-validated.

---

## 14. How to update this file

Update `progress.md` in the same pull request that completes a task. Move items between ⬜, 🟡 and ✅, update "Last updated", "Current focus" and "Current status", and add any new decision to section 11.
