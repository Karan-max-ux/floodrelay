# Flood Rescue Resource Allocation Platform

A flood-rescue resource allocation platform. Citizens submit rescue requests, the system clusters demand and proposes assignments of rescue resources (boats, vehicles) to requests under capacity and availability constraints, and operators review and commit them on a live map.

## What this is / What this is not

**What this is:**

- A decision-support tool for human operators coordinating flood rescue resources.
- Operators review proposed assignments and commit them. The system does not act autonomously.
- Demo rescue requests are simulated, seeded, reproducible, and always labelled `SIMULATED`.

**What this is not:**

- Not an autonomous dispatch system. A human operator always makes the final call.
- Not a replacement for emergency services communication infrastructure.
- Simulated requests are not real incidents and are clearly marked as such.

## Folder structure

```
/
├── README.md
├── progress.md
├── CONTRIBUTING.md
├── .gitignore
├── apps/
│   └── web/              (Next.js frontend, added later)
├── services/
│   └── api/              (Node.js backend, added later)
├── packages/
│   ├── solver/           (clustering + allocation library, no DB/HTTP dependencies)
│   └── shared/           (shared TypeScript types)
├── scenarios/            (seeded simulated scenarios and generator config)
├── infra/                (docker-compose and setup files, added later)
└── docs/
    ├── decisions.md      (architecture decision log)
    ├── limitations.md    (honest limitations)
    └── osrm.md           (OSRM road network routing guide)
```

## Getting started

### Prerequisites

- Node.js >= 24 (see `.nvmrc`)
- npm >= 10

### Installation

Clone the repository and install dependencies from the root:

```bash
npm ci
```

### Running checks

```bash
# Run ESLint across the codebase
npm run lint

# Run TypeScript typechecks across all workspaces
npm run typecheck

# Run unit tests (Vitest)
npm test

# Check code formatting (Prettier)
npm run format:check

# Auto-format code
npm run format
```

### Scenarios and evaluation

The repository contains seeded synthetic scenarios for testing and benchmark evaluation:

- `scenarios/sample-scenario.json`: A simulated baseline scenario (North Delhi / Yamuna basin) containing 10 simulated rescue requests, 3 resources, and 2 shelters. All data in this file is strictly simulated (`"simulated": true`) and does not represent real-world emergency incidents.
- Standard benchmark sizes:
  - Small: 20 requests / 4 resources / 2 shelters
  - Medium: 100 requests / 12 resources / 3 shelters
  - Large: 500 requests / 30 resources / 5 shelters
- Evaluation harness: Run `npx tsx scenarios/evaluate.ts` to evaluate allocation solvers across reproducible synthetic scenarios (solvers evaluated: Nearest-First (Greedy), Urgency-batched savings + 2-opt, and Cluster-Allocation; pass `--include-ortools` to include the Google OR-Tools baseline).

**Evaluation trade-offs & data notice:**

- Solvers balance competing objectives: minimizing total route travel duration vs. minimizing wait times for critical, high-urgency rescues. A lower total travel time does not automatically indicate superior dispatch quality, as greedily minimizing local distance can delay critical rescues.
- Relative solver performance varies with scenario scale and seed set. For current benchmark numbers across scenario scales, run `npx tsx scenarios/evaluate.ts`.
- All scenario data (requests, resource locations, safe shelters) is purely synthetic and simulated. Travel times are estimates calculated using assumed placeholder speeds and detour factors rather than live traffic or empirical disaster telemetry. See [docs/limitations.md](docs/limitations.md) and [docs/evaluation.md](docs/evaluation.md).

## How we work

All changes go through pull requests against the protected `main` branch with teammate approval.
See [CONTRIBUTING.md](CONTRIBUTING.md#how-we-work) for our full development and review workflow.

## Links

- [Progress and roadmap](progress.md) — the team's single source of truth
- [Contributing guidelines](CONTRIBUTING.md)
- [Architecture decisions](docs/decisions.md)
- [Known limitations](docs/limitations.md)
- [OSRM routing guide](docs/osrm.md)
