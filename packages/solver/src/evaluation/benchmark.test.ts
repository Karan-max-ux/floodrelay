import { describe, expect, it, vi } from 'vitest';
import {
  ALL_SOLVERS,
  evaluateSolversOnCase,
  formatMarkdownResultsTable,
  STANDARD_BENCHMARK_CASES,
} from './benchmark.js';

// Tests that spawn the OR-Tools Python process can exceed vitest's 5 s default when the full suite runs in parallel.
vi.setConfig({ testTimeout: 30_000 });

describe('Solver Evaluation Benchmark Harness', () => {
  it('evaluates standard solvers across random seeds and generates a results table', () => {
    const smallCase = STANDARD_BENCHMARK_CASES[0]!;
    expect(smallCase).toBeDefined();

    const summaries = evaluateSolversOnCase(smallCase, 3);

    expect(summaries).toHaveLength(3);
    const solverNames = summaries.map((s) => s.solverName);
    expect(solverNames).toContain('Nearest-First (Greedy)');
    expect(solverNames).toContain('Cluster-Allocation');
    expect(solverNames).toContain('Urgency-batched savings + 2-opt');

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
    expect(markdownTable).toContain('Urgency-batched savings + 2-opt');
  });

  it('evaluates with Google OR-Tools when ALL_SOLVERS is provided', () => {
    const smallCase = STANDARD_BENCHMARK_CASES[0]!;
    const summaries = evaluateSolversOnCase(smallCase, 1, ALL_SOLVERS, 42);
    expect(summaries).toHaveLength(4);
    expect(summaries.map((s) => s.solverName)).toContain('Google OR-Tools');
    const otSummary = summaries.find((s) => s.solverName === 'Google OR-Tools');
    expect(otSummary?.coverageMean).toBeGreaterThan(0);
  });
});
