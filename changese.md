# Project Change Log & Activity Tracking

**File:** `changes.md`  
**Last updated:** 2026-10-15  
**Current Branch:** `docs/phase-0-tasks`

---

## 1. Summary of Updates & Changes Made

### A. Phase 0 Task Tracking ([progress.md](progress.md))
- **Itemized Phase 0 Tasks**: Explicitly separated and added the following items to the Phase 0 table:
  - `Root README.md` (Status: ✅ Done)
  - `.gitignore` (Status: ✅ Done)
  - `.env.example` (Status: ✅ Done)
  - `docs/decisions.md` (Status: ✅ Done)
  - `Conventions (branch naming, commits, PR process)` (Status: ✅ Done)
  - `GitHub branch protection rule on main` (Status: ⬜ Not started / pending GitHub repository settings)
- **Updated Section 9 ("Current status")**: Reflected open items remaining for Phase 0 completion:
  1. GitHub branch protection rule on `main`.
  2. Workspace tooling (root `package.json`, `tsconfig`, lint configs).

### B. Contribution Guidelines ([CONTRIBUTING.md](CONTRIBUTING.md))
- **Aligned Branch Prefixes with Commit Types**:
  - Previously only allowed: `feature/`, `fix/`, `docs/`.
  - Added missing prefixes to match Conventional Commits:
    - `chore/<short-name>` — maintenance, tooling, configuration, and dependencies.
    - `refactor/<short-name>` — code changes that neither fix a bug nor add a feature.
    - `test/<short-name>` — adding or updating tests.
- **Deduplicated "Pull requests" Section**:
  - Removed duplicate rules ("main is protected", "at least one review", "keep PRs small") that were already stated in the "How we work" section.
  - Retained the core rule requiring `progress.md` updates with emoji status symbols (⬜, 🟡, ✅).
- **Added Standardized PR Checklist**:
  - Description: Clear explanation of what changed and why.
  - How to verify: Steps, commands, or test instructions to verify the change.
  - `progress.md` updated: Task status updated with appropriate emoji.
  - `docs/decisions.md` entry: Added or updated if an architectural decision was introduced or modified.

### C. GitHub PR Template ([.github/pull_request_template.md](.github/pull_request_template.md))
- Added `- [ ] docs/decisions.md entry added if architecture changed` to ensure pull requests on GitHub remind contributors to log architectural decisions.

### D. Verified Existing Artifacts
- **[docs/decisions.md](docs/decisions.md)**: Confirmed existing on disk and in git tracking. Contains the Architecture Decision Record (ADR) template and ADR-1 through ADR-7:
  - `ADR-1`: Next.js + React frontend
  - `ADR-2`: Separate Node.js backend
  - `ADR-3`: PostgreSQL + PostGIS
  - `ADR-4`: No machine learning
  - `ADR-5`: Build solver and evaluation before infrastructure
  - `ADR-6`: Operator commits assignments
  - `ADR-7`: Backend framework: Express with TypeScript
- **[README.md](README.md)**: Confirmed existing root README with project boundary descriptions and directory map.
- **[.gitignore](.gitignore)**: Confirmed existing comprehensive gitignore file.
- **[.env.example](.env.example)**: Confirmed existing PostgreSQL environment variable template.

---

## 2. What We Are Currently Doing & Next Steps

### 1. Enable GitHub Branch Protection on `main` (Pending Repository Settings)
- **Status**: ⬜ Open
- **Action Required**: The repository administrator needs to enable branch protection in GitHub Settings:
  - Require a pull request before merging (minimum 1 approval).
  - Do not allow bypassing the above settings (enforced for admins).
  - Require status checks to pass before merging (`CI skeleton`).

### 2. Workspace Tooling Setup (Completing Phase 0)
- **Status**: ⬜ Open (Next up in development)
- **Actions**:
  - Initialize root `package.json` with npm / pnpm / yarn workspaces configuring:
    - `apps/*` (`apps/web`)
    - `services/*` (`services/api`)
    - `packages/*` (`packages/shared`, `packages/solver`)
  - Set up shared root `tsconfig.json` with TypeScript strict mode enabled across all packages.
  - Configure code style and quality tools (ESLint, Prettier).

### 3. Transition to Phase 1 (Solver Core and Evaluation Harness)
- **Status**: ⬜ Planned
- **Actions**:
  - Define scenario schema in `packages/shared`.
  - Create seeded scenario generator in `scenarios/`.
  - Implement nearest-first greedy baseline and evaluation metrics harness.
  - Develop custom DBSCAN and assignment heuristic behind `TravelTimeProvider`.
