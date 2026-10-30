import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scenario } from '@floodrelay/shared';
import {
  runPerturbationStudy,
  formatPerturbationResultsMarkdown,
} from '../packages/solver/src/evaluation/perturbation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadScenario(filename: string): Scenario {
  const filePath = path.resolve(__dirname, filename);
  const data = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(data) as Scenario;
}

export function runCli(): void {
  const sample = loadScenario('sample-scenario.json');
  const name = sample.metadata?.name ?? sample.id;
  console.log(`Running Phase 4 perturbation study on "${name}" (${sample.id})...\n`);

  const results = runPerturbationStudy([sample], {
    magnitudes: [0, 0.1, 0.25, 0.5],
    seeds: [42, 1337, 2026],
  });

  const markdown = formatPerturbationResultsMarkdown(results);
  console.log(markdown);
}

runCli();
