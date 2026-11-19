import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '@floodrelay/api';
import {
  assertDisposableDemoDatabase,
  cleanupTrackedDemoFixtures,
  type DemoCleanupCounts,
} from './demoDbGuard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Backward compatible synchronous guard check.
 * Checks basic Node version and non-production flag.
 */
export function verifyDemoDatabaseSafety(): void {
  const nodeMajor = parseInt(process.versions.node.split('.')[0] || '0', 10);
  if (nodeMajor < 24) {
    throw new Error(`Node.js version 24 or higher is required. Found v${process.versions.node}`);
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'DEMO_SAFETY_VIOLATION: Cannot run demo scripts in production environment (NODE_ENV=production). Aborting.',
    );
  }

  const authFlag = process.env.ALLOW_DISPOSABLE_DEMO_DB;
  if (authFlag !== '1' && authFlag !== 'true') {
    throw new Error(
      'UNAUTHORIZED_DEMO_EXECUTION: Demo setup and cleanup require explicit authorization. ' +
        'Set ALLOW_DISPOSABLE_DEMO_DB=1 in a dedicated disposable demo environment.',
    );
  }
}

export async function runDemoCleanup(
  targetRunId?: string,
  options?: { closePool?: boolean },
): Promise<DemoCleanupCounts> {
  const pool = getPool();

  try {
    // 1. Strict failsafe verification: must be dedicated disposable demo db with identity marker
    await assertDisposableDemoDatabase(pool);

    // 2. Cleanup only tracked fixtures via durable manifest table
    const results = await cleanupTrackedDemoFixtures(pool, targetRunId);

    // 3. Remove local credentials file if present
    const credPath = path.resolve(__dirname, '../../.demo-credentials.local.json');
    if (fs.existsSync(credPath)) {
      try {
        fs.unlinkSync(credPath);
      } catch {
        // Ignore removal error
      }
    }

    console.log('--- FloodRelay Demo Cleanup Completed ---');
    console.log(`- Demo Runs Cleaned:           ${results.cleanedRuns}`);
    console.log(`- Assignment Stops removed:    ${results.deletedStops}`);
    console.log(`- Assignments removed:         ${results.deletedAssignments}`);
    console.log(`- Operational Events removed:  ${results.deletedOperationalEvents}`);
    console.log(`- Audit Events removed:        ${results.deletedAuditEvents}`);
    console.log(`- Blocked Zones removed:       ${results.deletedBlockedZones}`);
    console.log(`- Requests removed:            ${results.deletedRequests}`);
    console.log(`- Resources removed:           ${results.deletedResources}`);
    console.log(`- Shelters removed:            ${results.deletedShelters}`);
    console.log(`- Operators removed:           ${results.deletedOperators}`);
    console.log('-----------------------------------------');

    return results;
  } finally {
    if (options?.closePool ?? process.argv[1] === fileURLToPath(import.meta.url)) {
      await closePool();
    }
  }
}

// Execute when invoked directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const targetRunId = process.argv[2];
  runDemoCleanup(targetRunId)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Demo cleanup failed:', err);
      process.exit(1);
    });
}
