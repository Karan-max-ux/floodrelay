import { describe, expect, it } from 'vitest';
import {
  evaluateSolversOnCase,
  formatMarkdownResultsTable,
  STANDARD_BENCHMARK_CASES,
} from './benchmark.js';

describe('Solver Evaluation Benchmark Harness', () => {
  it('evaluates all solvers across random seeds and generates a results table', () => {
    const smallCase = STANDARD_BENCHMARK_CASES[0]!;
    expect(smallCase).toBeDefined();

    const summaries = evaluateSolversOnCase(smallCase, 3);

    expect(summaries).toHaveLength(3);
    const solverNames = summaries.map((s) => s.solverName);
    expect(solverNames).toContain('Nearest-First (Greedy)');
    expect(solverNames).toContain('Cluster-Allocation');
    expect(solverNames).toContain('OR-Tools CVRPTW');

    for (const summary of summaries) {
      expect(summary.seedsRun).toBe(3);
      expect(summary.coverageMean).toBeGreaterThan(0);
      expect(summary.travelTimeMean).toBeGreaterThan(0);
      expect(summary.solveTimeMsMean).toBeGreaterThanOrEqual(0);
    }

    const markdownTable = formatMarkdownResultsTable(summaries);
    expect(markdownTable).toContain('| Scenario Size | Solver | Seeds |');
    expect(markdownTable).toContain('Nearest-First (Greedy)');
    expect(markdownTable).toContain('Cluster-Allocation');
    expect(markdownTable).toContain('OR-Tools CVRPTW');
  });
});
