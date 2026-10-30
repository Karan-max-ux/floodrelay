import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ResourceRoute, Scenario, SolverPlan } from '@floodrelay/shared';
import { calculatePlanMetrics } from '../metrics.js';
import { assertValidSolverPlan } from '../planValidator.js';

export interface OrToolsOptions {
  maxShiftMinutes?: number;
  timeLimitSeconds?: number;
  pythonPath?: string;
  scriptPath?: string;
  existingFrozenRoutes?: ResourceRoute[];
}

/**
 * Resolves the repository root directory by walking up from the current module
 * until finding the directory containing tools/ortools-baseline.
 */
function getRepoRoot(): string {
  let curr = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(curr, 'tools/ortools-baseline/solver.py'))) {
      return curr;
    }
    const parent = dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return process.cwd();
}

/**
 * Resolves the path to the Python executable.
 * Prioritizes explicit option, environment variable, local virtualenv, then system Python.
 */
export function resolvePythonPath(explicitPath?: string): string {
  if (explicitPath) {
    return explicitPath;
  }

  if (process.env.FLOODRELAY_PYTHON_PATH && existsSync(process.env.FLOODRELAY_PYTHON_PATH)) {
    return process.env.FLOODRELAY_PYTHON_PATH;
  }

  const repoRoot = getRepoRoot();
  const venvWindows = resolve(repoRoot, 'tools/ortools-baseline/.venv/Scripts/python.exe');
  if (process.platform === 'win32' && existsSync(venvWindows)) {
    return venvWindows;
  }

  const venvUnix3 = resolve(repoRoot, 'tools/ortools-baseline/.venv/bin/python3');
  if (existsSync(venvUnix3)) {
    return venvUnix3;
  }

  const venvUnix = resolve(repoRoot, 'tools/ortools-baseline/.venv/bin/python');
  if (existsSync(venvUnix)) {
    return venvUnix;
  }

  return process.platform === 'win32' ? 'python' : 'python3';
}

/**
 * Resolves the path to the Python solver script.
 */
export function resolveSolverScriptPath(explicitPath?: string): string {
  if (explicitPath) {
    return explicitPath;
  }

  const repoRoot = getRepoRoot();
  return resolve(repoRoot, 'tools/ortools-baseline/solver.py');
}

/**
 * Google OR-Tools optimization baseline solver.
 * Invokes the Python OR-Tools RoutingModel implementation via a secure child process,
 * streaming scenario JSON via stdin and parsing the resulting plan from stdout.
 */
export function solveOrToolsBaseline(scenario: Scenario, options?: OrToolsOptions): SolverPlan {
  const startTime = Date.now();

  // Reject unsupported frozen routes or pre-assigned requests (Task 2)
  if (options?.existingFrozenRoutes && options.existingFrozenRoutes.length > 0) {
    throw new Error(
      'Google OR-Tools baseline is a static benchmark solver and does not support frozen stops or existing frozen routes. Use Cluster-Allocation for scenarios with committed frozen stops.',
    );
  }

  if (
    Array.isArray((scenario as { existingFrozenRoutes?: unknown[] }).existingFrozenRoutes) &&
    (scenario as { existingFrozenRoutes?: unknown[] }).existingFrozenRoutes!.length > 0
  ) {
    throw new Error(
      'Google OR-Tools baseline is a static benchmark solver and does not support frozen stops or existing frozen routes. Use Cluster-Allocation for scenarios with committed frozen stops.',
    );
  }

  for (const req of scenario.requests) {
    if (req.status && ['ASSIGNED', 'IN_TRANSIT', 'RESCUED'].includes(req.status)) {
      throw new Error(
        `Google OR-Tools baseline does not support pre-assigned/frozen requests (request '${req.id}' has status '${req.status}'). Use Cluster-Allocation for replanning with committed assignments.`,
      );
    }
  }

  const pythonPath = resolvePythonPath(options?.pythonPath);
  const scriptPath = resolveSolverScriptPath(options?.scriptPath);

  if (!existsSync(scriptPath)) {
    throw new Error(`OR-Tools solver script not found at: ${scriptPath}`);
  }

  const maxShift = options?.maxShiftMinutes ?? 480;
  const timeLimit = options?.timeLimitSeconds ?? 5;

  const args = [scriptPath, '--max-shift', String(maxShift), '--time-limit', String(timeLimit)];

  const payload = JSON.stringify(scenario);

  const timeoutMs = Math.ceil((timeLimit + 30) * 1000);

  const proc = spawnSync(pythonPath, args, {
    input: payload,
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024, // 50 MB
    timeout: timeoutMs,
    windowsHide: true,
  });

  if (proc.error) {
    throw new Error(
      `Failed to execute OR-Tools Python solver (${pythonPath}): ${proc.error.message}`,
    );
  }

  if (proc.status !== 0) {
    const stderr = proc.stderr ? proc.stderr.trim() : 'Unknown error';
    throw new Error(`OR-Tools Python solver exited with code ${proc.status}: ${stderr}`);
  }

  const stdout = proc.stdout ? proc.stdout.trim() : '';
  if (!stdout) {
    throw new Error('OR-Tools Python solver returned empty output');
  }

  let rawPlan: SolverPlan;
  try {
    rawPlan = JSON.parse(stdout) as SolverPlan;
  } catch (err) {
    throw new Error(
      `Failed to parse OR-Tools output JSON: ${err instanceof Error ? err.message : String(err)}\nOutput preview: ${stdout.slice(0, 300)}`,
      { cause: err },
    );
  }

  // Validate Python solver output independently against constraints and invariants
  assertValidSolverPlan(scenario, rawPlan, { maxShiftMinutes: maxShift, allowFrozen: false });

  const durationMs = Date.now() - startTime;
  const metrics = calculatePlanMetrics(scenario, rawPlan, durationMs);

  return {
    scenarioId: rawPlan.scenarioId ?? scenario.id,
    calculatedAt: rawPlan.calculatedAt ?? new Date().toISOString(),
    routes: rawPlan.routes ?? [],
    unserved: rawPlan.unserved ?? [],
    metrics,
  };
}
