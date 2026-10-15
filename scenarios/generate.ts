import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateScenario } from '@floodrelay/solver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(): { seed: number; requests: number; resources: number; out?: string } {
  const args = process.argv.slice(2);
  let seed = 42;
  let requests = 50;
  let resources = 6;
  let out: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--seed' && args[i + 1]) {
      seed = Number.parseInt(args[++i] ?? '42', 10);
    } else if (arg === '--requests' && args[i + 1]) {
      requests = Number.parseInt(args[++i] ?? '50', 10);
    } else if (arg === '--resources' && args[i + 1]) {
      resources = Number.parseInt(args[++i] ?? '6', 10);
    } else if (arg === '--out' && args[i + 1]) {
      out = args[++i];
    }
  }

  return { seed, requests, resources, out };
}

function run(): void {
  const { seed, requests, resources, out } = parseArgs();
  const scenario = generateScenario({
    seed,
    requestCount: requests,
    resourceCount: resources,
  });

  const targetPath = out ? path.resolve(out) : path.join(__dirname, `scenario-seed-${seed}.json`);

  fs.writeFileSync(targetPath, JSON.stringify(scenario, null, 2), 'utf-8');
  console.log(
    `Generated scenario with ${scenario.requests.length} requests, ${scenario.resources.length} resources at: ${targetPath}`,
  );
}

run();
