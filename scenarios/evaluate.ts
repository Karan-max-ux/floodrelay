import {
  ALL_SOLVERS,
  evaluateSolversOnCase,
  formatMarkdownResultsTable,
  STANDARD_BENCHMARK_CASES,
  STANDARD_SOLVERS,
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
const mediumOnly = args.includes('--medium-only');
const smallOnly = args.includes('--small-only');
const includeOrTools =
  args.includes('--include-ortools') ||
  args.includes('--with-ortools') ||
  args.includes('--all-solvers');

const seedIdx = args.indexOf('--seed');
const seedArg = seedIdx !== -1 && args[seedIdx + 1] ? Number(args[seedIdx + 1]) : undefined;

const seedCountIdx =
  args.indexOf('--seeds') !== -1 ? args.indexOf('--seeds') : args.indexOf('--count');
const seedCount =
  seedCountIdx !== -1 && args[seedCountIdx + 1] ? Number(args[seedCountIdx + 1]) : 20;

let casesToRun = STANDARD_BENCHMARK_CASES;
if (largeOnly) {
  casesToRun = STANDARD_BENCHMARK_CASES.filter((c) => c.name.toLowerCase().includes('large'));
} else if (mediumOnly) {
  casesToRun = STANDARD_BENCHMARK_CASES.filter((c) => c.name.toLowerCase().includes('medium'));
} else if (smallOnly) {
  casesToRun = STANDARD_BENCHMARK_CASES.filter((c) => c.name.toLowerCase().includes('small'));
}

const solvers = includeOrTools ? ALL_SOLVERS : STANDARD_SOLVERS;
const solverNames = Object.keys(solvers).join(', ');
console.log(`Active Solvers: ${solverNames}`);

const allSummaries = [];

for (const benchCase of casesToRun) {
  const seedInfo =
    seedArg !== undefined ? `baseSeed = ${seedArg}, seeds = ${seedCount}` : `seeds = ${seedCount}`;
  console.log(`Evaluating: ${benchCase.name} (${seedInfo})...`);
  const summaries = evaluateSolversOnCase(benchCase, seedCount, solvers, seedArg);
  allSummaries.push(...summaries);
}

console.log('\n### Benchmark Results Table\n');
console.log(formatMarkdownResultsTable(allSummaries));
