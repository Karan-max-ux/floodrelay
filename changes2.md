# Project Change Log 2 — Phase 0 Completion & GitHub Sync

**File:** `changes2.md`  
**Date:** 2026-10-15  
**Current Branch:** `main`  
**Latest Commit:** `ee97471` (Merge pull request #7 from Parssharma/chore/workspace-tooling)

---

## 1. Summary of Changes Pulled from GitHub

The local repository was synchronized with `origin/main` (fast-forwarded by 13 commits across 3 merged pull requests).

### Merged Pull Requests:
1. **PR #5 (`docs/tidy-progress-and-contributing`)**:
   - Aligned `CONTRIBUTING.md` (added `chore/`, `refactor/`, `test/` branch prefixes; deduplicated PR section; added PR checklist).
   - Itemized Phase 0 tasks in `progress.md`.
   - Updated `.github/pull_request_template.md`.

2. **PR #6 (`docs/remove-duplicate-activity-log`)**:
   - Cleaned up duplicate activity logs (`changes.md`, `changese.md`).
   - Marked GitHub branch protection rule as ✅ done in `progress.md`.

3. **PR #7 (`chore/workspace-tooling`)**:
   - **Monorepo & Tooling Configuration**:
     - Configured root `package.json` with npm workspaces (`apps/*`, `services/*`, `packages/*`).
     - Added `.nvmrc` locking Node version (`>=24`).
     - Configured root `tsconfig.base.json` with strict TypeScript settings (`NodeNext` module resolution, ES2022 target).
     - Configured ESLint (`eslint.config.js` flat config with `@eslint/js`, `typescript-eslint`, and `eslint-config-prettier`).
     - Added `.prettierrc.json` and `.prettierignore`.
   - **Packages Created**:
     - **`@floodrelay/shared`** (`packages/shared/`): Configured `package.json`, `tsconfig.json`, and initial entry point `src/index.ts`.
     - **`@floodrelay/solver`** (`packages/solver/`): Configured `package.json`, `tsconfig.json`, `src/index.ts` with haversine distance function, and `src/haversine.test.ts` unit tests using Vitest.
   - **CI Pipeline Updated**:
     - `.github/workflows/ci.yml` enabled steps for `npm ci`, `npm run lint`, `npm run typecheck`, and `npm test` against the live PostGIS service container.
   - **Documentation & Decisions Updated**:
     - `docs/decisions.md`: Added **ADR-8** (Workspace tooling, testing, and monorepo structure using npm workspaces and Vitest).
     - `README.md`: Added getting started guide, local setup, test execution instructions, and tech stack versions.
     - `progress.md`: Marked all Phase 0 tasks as ✅ done.

---

## 2. Phase 0 Status: 100% COMPLETE ✅

**Yes, your friend has completely finished Phase 0!**

| Phase 0 Task | Status | Notes |
|---|---|---|
| Root README.md | ✅ Done | Getting started and structure documented. |
| .gitignore | ✅ Done | Excludes node_modules, build outputs, OSM data, env files. |
| .env.example | ✅ Done | PostgreSQL / PostGIS configuration template. |
| docs/decisions.md | ✅ Done | ADR-1 through ADR-8 documented. |
| Conventions (branching, commits, PRs) | ✅ Done | Conventional Commits, branch prefixes, PR checklist. |
| GitHub branch protection rule on main | ✅ Done | Marked done in progress.md. |
| Folder structure | ✅ Done | apps, services, packages, scenarios, infra, docs. |
| Workspace tooling | ✅ Done | npm workspaces, TypeScript, ESLint, Prettier, Vitest. |
| docker-compose for Postgres/PostGIS | ✅ Done | PostGIS 16-3.4 service container. |
| CI skeleton | ✅ Done | GitHub Actions running lint, typecheck, and test. |
| Agree on backend framework | ✅ Done | Express with TypeScript (ADR-7). |

---

## 3. Next Focus: Phase 1 — Solver Core and Evaluation Harness

The project focus has now officially transitioned to **Phase 1**. The ordered implementation tasks are:

1. ⬜ **Scenario format**: Define JSON / TypeScript scenario schema in `packages/shared`.
2. ⬜ **Seeded generator**: Create reproducible test scenario generator in `scenarios/`.
3. ⬜ **Metrics**: Coverage, total travel time, wait time for high priority, solve time, churn.
4. ⬜ **Nearest-first baseline**: Initial greedy allocation heuristic.
5. ⬜ **Own DBSCAN**: Custom clustering implementation in `packages/solver`.
6. ⬜ **First allocation heuristic**: Allocation with straight-line distance behind `TravelTimeProvider`.
7. ⬜ **OR-Tools baseline**: Baseline solver for comparison.
8. ⬜ **Results-table script**: Evaluation script running benchmarks.
