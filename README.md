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
    └── limitations.md    (honest limitations)
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

## How we work

All changes go through pull requests against the protected `main` branch with teammate approval.
See [CONTRIBUTING.md](CONTRIBUTING.md#how-we-work) for our full development and review workflow.

## Links

- [Progress and roadmap](progress.md) — the team's single source of truth
- [Contributing guidelines](CONTRIBUTING.md)
- [Architecture decisions](docs/decisions.md)
- [Known limitations](docs/limitations.md)
