import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateScenario } from '@floodrelay/solver';
import type { Scenario } from '@floodrelay/shared';
import { getPool, closePool } from '../db/connection.js';
import { runMigrationsUp } from '../db/migrator.js';
import { PostgisRepository } from '../db/repository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveScenarioFilePath(candidatePath?: string): string {
  if (candidatePath && fs.existsSync(candidatePath)) {
    return path.resolve(candidatePath);
  }

  const relativeTargets = [candidatePath, 'scenarios/sample-scenario.json'].filter(
    Boolean,
  ) as string[];

  const searchRoots = [
    process.cwd(),
    path.resolve(process.cwd(), '../..'),
    path.resolve(__dirname, '../../..'),
    path.resolve(__dirname, '../../../..'),
  ];

  for (const root of searchRoots) {
    for (const rel of relativeTargets) {
      const fullPath = path.resolve(root, rel);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
  }

  throw new Error(
    `Scenario file not found: "${candidatePath || 'scenarios/sample-scenario.json'}"`,
  );
}

export function parseSeedArgs(args: string[]): {
  filePath?: string;
  generate: boolean;
  seed: number;
  requests: number;
  resources: number;
  shelters: number;
  dryRun: boolean;
} {
  let filePath: string | undefined;
  let generate = false;
  let seed = 42;
  let requests = 20;
  let resources = 4;
  let shelters = 2;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--file' && args[i + 1]) {
      filePath = args[++i]!;
    } else if (arg === '--generate') {
      generate = true;
    } else if (arg === '--seed' && args[i + 1]) {
      seed = parseInt(args[++i]!, 10);
    } else if (arg === '--requests' && args[i + 1]) {
      requests = parseInt(args[++i]!, 10);
    } else if (arg === '--resources' && args[i + 1]) {
      resources = parseInt(args[++i]!, 10);
    } else if (arg === '--shelters' && args[i + 1]) {
      shelters = parseInt(args[++i]!, 10);
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  return { filePath, generate, seed, requests, resources, shelters, dryRun };
}

export async function loadScenarioFromFileOrGenerate(
  options: ReturnType<typeof parseSeedArgs>,
): Promise<Scenario> {
  if (options.generate) {
    const generated = generateScenario({
      seed: options.seed,
      requestCount: options.requests,
      resourceCount: options.resources,
      shelterCount: options.shelters,
    });
    return {
      ...generated,
      simulated: true,
      syntheticDataNote: 'Dynamically generated scenario for algorithmic testing',
    };
  }

  const resolvedPath = resolveScenarioFilePath(options.filePath);
  const rawJson = fs.readFileSync(resolvedPath, 'utf-8');
  return JSON.parse(rawJson) as Scenario;
}

export async function runScenarioSeeder(args = process.argv.slice(2)): Promise<{
  scenarioId: string;
  requestsCount: number;
  resourcesCount: number;
  sheltersCount: number;
  isSimulated: boolean;
}> {
  const options = parseSeedArgs(args);
  const scenario = await loadScenarioFromFileOrGenerate(options);

  console.log(`Loading scenario: "${scenario.metadata.name}" (${scenario.id})`);
  console.log(
    `Requests: ${scenario.requests.length}, Resources: ${scenario.resources.length}, Shelters: ${scenario.shelters.length}`,
  );
  console.log(
    `Simulated provenance: ${scenario.simulated || scenario.metadata?.simulated ? 'YES (all rows keep SIMULATED label)' : 'NO'}`,
  );

  if (options.dryRun) {
    console.log('Dry run complete. No database changes made.');
    return {
      scenarioId: scenario.id,
      requestsCount: scenario.requests.length,
      resourcesCount: scenario.resources.length,
      sheltersCount: scenario.shelters.length,
      isSimulated: Boolean(scenario.simulated || scenario.metadata?.simulated),
    };
  }

  const pool = getPool();
  try {
    // Ensure migrations are up to date
    await runMigrationsUp(pool);

    const repo = new PostgisRepository(pool);
    const result = await repo.loadScenario(scenario);

    console.log('Successfully seeded scenario into PostGIS database:');
    console.log(`  - Scenario ID: ${result.scenarioId}`);
    console.log(
      `  - Requests Inserted: ${result.requestsCount} (source: ${result.isSimulated ? 'SIMULATED' : 'REPORTED'})`,
    );
    console.log(`  - Resources Inserted: ${result.resourcesCount}`);
    console.log(`  - Shelters Inserted: ${result.sheltersCount}`);

    return result;
  } finally {
    await closePool();
  }
}

// Execute when invoked directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runScenarioSeeder()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Scenario seeder failed:', err);
      process.exit(1);
    });
}
