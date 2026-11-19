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

### Running the Application

1. **Start the API backend service (port 3001):**
   ```bash
   npm run dev -w @floodrelay/api
   ```
2. **Start the Next.js frontend web application (port 3000):**
   ```bash
   npm run dev -w @floodrelay/web
   ```
3. **Access the Portals in your browser:**
   - **Citizen Rescue Request Portal:** [http://localhost:3000/citizen/request](http://localhost:3000/citizen/request)
   - **Operator Command Center Login:** [http://localhost:3000/operator/login](http://localhost:3000/operator/login)
   - **Operator Dashboard:** [http://localhost:3000/operator](http://localhost:3000/operator)
   - **GIS Operations Map:** [http://localhost:3000/operator/map](http://localhost:3000/operator/map)
   - **Rescue Requests Management:** [http://localhost:3000/operator/requests](http://localhost:3000/operator/requests)
   - **Assignments & Solver Proposals:** [http://localhost:3000/operator/assignments](http://localhost:3000/operator/assignments)

### Operator Account Provisioning & Security

To access the Operator Command Center, an operator account must be provisioned.

#### Local Development

In non-production environments with an unseeded database, the backend automatically initializes an initial operator account upon first startup. You can customize the credentials by setting environment variables in `.env`:

```bash
INITIAL_OPERATOR_USERNAME=eoc_operator
INITIAL_OPERATOR_PASSWORD="<choose-a-local-password>"
INITIAL_OPERATOR_NAME="Capt. R. Vance"
```

Additional operator accounts can be provisioned at any time using the administrative CLI:

```bash
npm --workspace=@floodrelay/api run create-operator <username> <password> [name] [role]
```

#### Production Security & Credential Rotation

In production (`NODE_ENV=production`), automatic seeding with default development credentials is **disabled by design**. Any attempt to authenticate with or configure known default development credentials in production is strictly rejected with a security violation.

Production operator accounts must be provisioned with unique, high-entropy credentials via `INITIAL_OPERATOR_USERNAME` and `INITIAL_OPERATOR_PASSWORD` during deployment, or via the `create-operator` CLI script.

> [!WARNING]
> **Credential Rotation Notice**: If development credentials or temporary passwords were deployed or used in any environment, rotate them immediately following your organization's credential rotation procedure.

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

- `scenarios/sample-scenario.json`: A simulated baseline scenario (North Delhi / Yamuna basin) containing 5 simulated rescue requests, 3 simulated resources, and 2 simulated relief camps. All data in this file is strictly simulated (`"simulated": true`) and does not represent real-world emergency incidents or official agency assets.
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
- [Operational Limitations & Boundaries Page](docs/limitations.md) (Web route: `/limitations`)
- [OSRM routing guide](docs/osrm.md)
