import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scenario, SolverPlan } from '@floodrelay/shared';
import {
  prepareTravelTimeProvider,
  solveNearestFirst,
  solveClarkeWrightBaseline,
  solveClusterAllocation,
  StraightLineTravelTimeProvider,
  type TravelTimeProvider,
} from '../packages/solver/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadScenario(filename: string): Scenario {
  const filePath = path.resolve(__dirname, filename);
  const data = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(data) as Scenario;
}

export async function runOsrmCheck(): Promise<void> {
  const baseUrl = process.env.OSRM_BASE_URL || 'http://127.0.0.1:5000';
  const profile = process.env.OSRM_PROFILE || 'driving';

  console.log('='.repeat(70));
  console.log('FloodRelay OSRM Integration & Road Network Verification');
  console.log('='.repeat(70));
  console.log(`OSRM Base URL: ${baseUrl}`);
  console.log(`OSRM Profile:  ${profile}`);

  const scenario = loadScenario('sample-scenario.json');
  console.log(`Scenario:      ${scenario.metadata?.name ?? scenario.id}`);
  console.log(
    `Entities:      ${scenario.requests.length} requests, ${scenario.resources.length} resources, ${scenario.shelters.length} shelters`,
  );
  console.log('-'.repeat(70));

  console.log('\n[1/3] Preparing OSRM travel time provider and prefetching table...');
  const { provider: osrmProvider, report } = await prepareTravelTimeProvider(scenario, {
    osrm: {
      baseUrl,
      profile,
    },
  });

  const straightLineProvider = new StraightLineTravelTimeProvider();

  console.log('\n[2/3] Executing solvers (Straight-Line vs OSRM)...');

  const algorithms = [
    {
      name: 'Nearest-First Baseline',
      run: (p: TravelTimeProvider): SolverPlan =>
        solveNearestFirst(scenario, { travelTimeProvider: p }),
    },
    {
      name: 'Clarke-Wright Savings + 2-opt',
      run: (p: TravelTimeProvider): SolverPlan =>
        solveClarkeWrightBaseline(scenario, { travelTimeProvider: p }),
    },
    {
      name: 'Cluster-Allocation (Urgency-batched)',
      run: (p: TravelTimeProvider): SolverPlan =>
        solveClusterAllocation(scenario, { travelTimeProvider: p }),
    },
  ];

  const results: Array<{
    algorithm: string;
    slDist: number;
    osrmDist: number;
    distRatio: string;
    slTime: number;
    osrmTime: number;
    timeRatio: string;
    slServed: number;
    osrmServed: number;
  }> = [];

  for (const alg of algorithms) {
    const slPlan = alg.run(straightLineProvider);
    const osrmPlan = alg.run(osrmProvider);

    const slDist = slPlan.metrics.totalTravelDistanceKm;
    const osrmDist = osrmPlan.metrics.totalTravelDistanceKm;
    const distRatio = slDist > 0 ? (osrmDist / slDist).toFixed(2) + 'x' : 'N/A';

    const slTime = slPlan.metrics.totalTravelTimeMinutes;
    const osrmTime = osrmPlan.metrics.totalTravelTimeMinutes;
    const timeRatio = slTime > 0 ? (osrmTime / slTime).toFixed(2) + 'x' : 'N/A';

    results.push({
      algorithm: alg.name,
      slDist,
      osrmDist,
      distRatio,
      slTime,
      osrmTime,
      timeRatio,
      slServed: slPlan.metrics.servedRequestsCount,
      osrmServed: osrmPlan.metrics.servedRequestsCount,
    });
  }

  console.log('\n[3/3] Results Comparison:');
  console.log('-'.repeat(70));
  for (const r of results) {
    console.log(`Algorithm: ${r.algorithm}`);
    console.log(
      `  Distance: Straight-line ${r.slDist.toFixed(2)} km  ->  OSRM ${r.osrmDist.toFixed(2)} km (${r.distRatio})`,
    );
    console.log(
      `  Duration: Straight-line ${r.slTime.toFixed(1)} min ->  OSRM ${r.osrmTime.toFixed(1)} min (${r.timeRatio})`,
    );
    console.log(
      `  Served:   Straight-line ${r.slServed}/${scenario.requests.length} -> OSRM ${r.osrmServed}/${scenario.requests.length}`,
    );
    console.log();
  }

  const finalReport = report();
  console.log('='.repeat(70));
  console.log('Travel Time & Road Coverage Report:');
  console.log('='.repeat(70));
  console.log(`Effective Source:       ${finalReport.effectiveSource}`);
  console.log(`OSRM Configured:        ${finalReport.osrmConfigured}`);
  console.log(`OSRM HTTP Requests:     ${finalReport.osrmRequests}`);
  console.log(`OSRM Failed Requests:   ${finalReport.osrmFailedRequests}`);
  console.log(`Lookups (OSRM Road):    ${finalReport.lookupsOsrm}`);
  console.log(`Lookups (SL Policy):    ${finalReport.lookupsStraightLinePolicy}`);
  console.log(`Lookups (Fallback SL):  ${finalReport.lookupsFallback}`);
  console.log(
    `Road Coverage:          ${
      finalReport.roadCoveragePercent !== null
        ? `${finalReport.roadCoveragePercent.toFixed(1)}%`
        : 'N/A (Straight-Line only)'
    }`,
  );
  console.log(`Hazard Zones:           ${finalReport.hazardZoneCount}`);
  if (finalReport.warnings.length > 0) {
    console.log('Warnings:');
    for (const w of finalReport.warnings) {
      console.log(`  - ${w}`);
    }
  }
  console.log('='.repeat(70));
}

// Self-executing CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runOsrmCheck().catch((err) => {
    console.error('Fatal error running OSRM check:', err);
    process.exit(1);
  });
}
