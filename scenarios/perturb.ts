import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scenario } from '@floodrelay/shared';
import {
  runPerturbationStudy,
  formatPerturbationResultsMarkdown,
} from '../packages/solver/src/evaluation/perturbation.js';
import { generateScenario } from '../packages/solver/src/generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadScenario(filename: string): Scenario {
  const filePath = path.resolve(__dirname, filename);
  const data = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(data) as Scenario;
}

export function runCli(): void {
  const args = process.argv.slice(2);
  const isSmoke = args.includes('--smoke') || args.some((a) => a.includes('sample-scenario.json'));

  if (isSmoke) {
    const sample = loadScenario('sample-scenario.json');
    const name = sample.metadata?.name ?? sample.id;
    console.log(`Running Phase 4 smoke test on "${name}" (${sample.id})...\n`);

    const results = runPerturbationStudy([sample], {
      magnitudes: [0, 0.1, 0.25, 0.5],
      seeds: [42, 1337, 2026],
    });

    const markdown = formatPerturbationResultsMarkdown(results);
    console.log(markdown);
    return;
  }

  console.log(
    'Running Phase 4 perturbation study across 20 generated scenarios (40 req / 6 veh / 3 shelt, 5 noise draws each)...\n',
  );

  const scenarioSeeds = Array.from({ length: 20 }, (_, i) => 2026 + i);
  const scenarios = scenarioSeeds.map((seed) =>
    generateScenario({
      seed,
      requestCount: 40,
      resourceCount: 6,
      shelterCount: 3,
    }),
  );

  const noiseSeeds = [42, 1337, 2026, 7777, 9999];
  const magnitudes = [0, 0.1, 0.25, 0.5];

  const results = runPerturbationStudy(scenarios, {
    magnitudes,
    seeds: noiseSeeds,
  });

  const map = new Map<
    string,
    {
      assignment: number[];
      route: number[];
      sequence: number[];
      delta: number[];
    }
  >();

  for (const row of results.rows) {
    const solver = row.solverName;
    const key = `${solver}|${row.magnitude}`;
    if (!map.has(key)) {
      map.set(key, { assignment: [], route: [], sequence: [], delta: [] });
    }
    const entry = map.get(key)!;
    entry.assignment.push(row.assignmentChurnRate);
    entry.route.push(row.routeChurnRate);
    entry.sequence.push(row.sequenceChurnRate);
    entry.delta.push(row.coverageDelta);
  }

  const solvers = [
    'Nearest-First (Greedy)',
    'Cluster-Allocation',
    'Urgency-batched savings + 2-opt',
  ];

  const lines = [
    '| Solver | Magnitude | Assignment Churn (%) | Route Churn (%) | Sequence Churn (%) | Coverage Delta |',
    '| :--- | :---: | :---: | :---: | :---: | :---: |',
  ];

  for (const solver of solvers) {
    for (const mag of magnitudes) {
      const key = `${solver}|${mag}`;
      const entry = map.get(key)!;
      const meanAssign =
        (entry.assignment.reduce((a, b) => a + b, 0) / entry.assignment.length) * 100;
      const meanRoute = (entry.route.reduce((a, b) => a + b, 0) / entry.route.length) * 100;
      const meanSeq = (entry.sequence.reduce((a, b) => a + b, 0) / entry.sequence.length) * 100;
      const meanDelta = entry.delta.reduce((a, b) => a + b, 0) / entry.delta.length;

      const magLabel = mag === 0 ? '0% (Control)' : `${(mag * 100).toFixed(0)}%`;
      const deltaStr = meanDelta >= 0 ? `+${meanDelta.toFixed(2)}` : `${meanDelta.toFixed(2)}`;

      lines.push(
        `| ${solver} | ${magLabel} | ${meanAssign.toFixed(1)}% | ${meanRoute.toFixed(1)}% | ${meanSeq.toFixed(1)}% | ${deltaStr} |`,
      );
    }
  }

  console.log(lines.join('\n'));
}

runCli();
