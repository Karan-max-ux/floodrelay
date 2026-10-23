import {
  evaluateSolversOnCase,
  formatMarkdownResultsTable,
  STANDARD_BENCHMARK_CASES,
} from '@floodrelay/solver';

console.log('================================================================================');
console.log('FLOODRELAY SOLVER EVALUATION BENCHMARK');
console.log('NOTICE: All scenario requests, resources, and shelters are SIMULATED.');
console.log('NOTICE: Travel times are assumptions and estimates (uncalibrated placeholders).');
console.log('NOTICE: Benchmark results are synthetic and not real-world benchmarks.');
console.log('================================================================================\n');

// Parse CLI flags
const args = process.argv.slice(2);
const largeOnly = args.includes('--large-only');

const seedIdx = args.indexOf('--seed');
const seedArg = seedIdx !== -1 && args[seedIdx + 1] ? Number(args[seedIdx + 1]) : undefined;

const seedCountIdx =
  args.indexOf('--seeds') !== -1 ? args.indexOf('--seeds') : args.indexOf('--count');
const seedCount =
  seedCountIdx !== -1 && args[seedCountIdx + 1] ? Number(args[seedCountIdx + 1]) : 20;

const casesToRun = largeOnly
  ? STANDARD_BENCHMARK_CASES.filter((c) => c.name.toLowerCase().includes('large'))
  : STANDARD_BENCHMARK_CASES;

const allSummaries = [];

for (const benchCase of casesToRun) {
  const seedInfo =
    seedArg !== undefined
      ? `baseSeed = ${seedArg}, seeds = ${seedCount}`
      : `seeds = ${seedCount}`;
  console.log(`Evaluating: ${benchCase.name} (${seedInfo})...`);
  const summaries = evaluateSolversOnCase(benchCase, seedCount, undefined, seedArg);
  allSummaries.push(...summaries);
}

console.log('\n### Benchmark Results Table\n');
console.log(formatMarkdownResultsTable(allSummaries));

