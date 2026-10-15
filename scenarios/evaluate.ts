import {
  evaluateSolversOnCase,
  formatMarkdownResultsTable,
  STANDARD_BENCHMARK_CASES,
} from '@floodrelay/solver';

console.log('=== FloodRelay Solver Evaluation Benchmark ===');
console.log('Running evaluation across benchmark cases...\n');

const allSummaries = [];

for (const benchCase of STANDARD_BENCHMARK_CASES) {
  console.log(`Evaluating: ${benchCase.name} (seeds = 5)...`);
  const summaries = evaluateSolversOnCase(benchCase, 5);
  allSummaries.push(...summaries);
}

console.log('\n### Benchmark Results Table\n');
console.log(formatMarkdownResultsTable(allSummaries));
