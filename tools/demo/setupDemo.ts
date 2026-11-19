import crypto from 'node:crypto';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scenario } from '@floodrelay/shared';
import {
  getPool,
  closePool,
  runMigrationsUp,
  PostgisRepository,
  AuthService,
  AssignmentService,
  OperationalEventService,
  RepairOrchestrationService,
  IncrementalRepairSolverAdapter,
} from '@floodrelay/api';
import {
  assertDisposableDemoDatabase,
  cleanupTrackedDemoFixtures,
  recordDemoRunManifest,
  DEMO_OPERATOR_OWNERSHIP_TABLE,
  type DemoRunManifest,
} from './demoDbGuard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export async function runDemoSetup(options?: { closePool?: boolean }): Promise<{
  runId: string;
  scenarioId: string;
  baselineAssignmentId: string;
  repairedProposalId: string;
  disruptionEventId: string;
  frozenStopsCount: number;
  churnRate: number;
  credentialsFile: string;
  isSimulationPreview?: boolean;
}> {
  console.log('===============================================================');
  console.log('🌊 FloodRelay — End-to-End Demonstration Environment Setup');
  console.log('===============================================================');

  const pool = getPool();
  try {
    // Step 1: Strict disposable demo database safety verification
    console.log('Verifying disposable demo database safety guard...');
    const dbInfo = await assertDisposableDemoDatabase(pool);
    console.log(
      `✔ Database safety guard passed: Verified disposable demo target "${dbInfo.databaseName}" on "${dbInfo.serverAddr || 'local'}" as "${dbInfo.dbUser}".`,
    );

    // Step 2: Ensure schema migrations are applied
    console.log('Applying database migrations up to latest...');
    await runMigrationsUp(pool);
    console.log('✔ Migrations verified.');

    const repo = new PostgisRepository(pool);
    const authService = new AuthService(repo);
    const eventService = new OperationalEventService(repo);
    const repairSolver = new IncrementalRepairSolverAdapter(repo);
    const repairService = new RepairOrchestrationService(repo, repairSolver);
    const assignmentService = new AssignmentService(repo);

    // Step 3: Clean prior tracked demo runs for idempotent clean slate
    console.log('Cleaning previous tracked demo runs if present...');
    const cleanupCounts = await cleanupTrackedDemoFixtures(pool, undefined, {
      preserveOperators: true,
    });
    if (cleanupCounts.cleanedRuns > 0) {
      console.log(
        `✔ Purged prior demo fixtures (${cleanupCounts.cleanedRuns} run(s), ${cleanupCounts.deletedRequests} requests, ${cleanupCounts.deletedAssignments} assignments).`,
      );
    } else {
      console.log('✔ Clean slate confirmed.');
    }

    // Initialize collision-resistant run tracking manifest in INITIALIZING state
    const runId = `demo_run_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const manifest: DemoRunManifest = {
      runId,
      status: 'INITIALIZING',
      requestIds: [],
      assignmentIds: [],
      assignmentStopIds: [],
      resourceIds: [],
      shelterIds: [],
      blockedZoneIds: [],
      operationalEventIds: [],
      auditEventIds: [],
      operatorUsernames: [],
      createdOperatorUsernames: [],
      reusedOperatorUsernames: [],
    };
    await recordDemoRunManifest(pool, manifest);

    try {
      // Step 4: Seed deterministic demo scenario
      const scenarioPath = path.resolve(__dirname, '../../scenarios/demo-yamuna-scenario.json');
      if (!fs.existsSync(scenarioPath)) {
        throw new Error(`Demo scenario file not found at: ${scenarioPath}`);
      }
      const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf-8')) as Scenario;
      manifest.scenarioId = scenario.id;

      console.log(`Seeding demo scenario: "${scenario.metadata.name}" (${scenario.id})...`);
      const seedResult = await repo.loadScenario(scenario);
      console.log(
        `✔ Scenario loaded: ${seedResult.requestsCount} requests, ${seedResult.resourcesCount} resources, ${seedResult.sheltersCount} shelters (labeled SIMULATED).`,
      );

      // Track seeded scenario entity IDs in durable manifest
      manifest.requestIds.push(...scenario.requests.map((r) => r.id));
      manifest.resourceIds.push(...scenario.resources.map((r) => r.id));
      manifest.shelterIds.push(...scenario.shelters.map((s) => s.id));
      await recordDemoRunManifest(pool, manifest);

      // Step 5: Provision demonstration operator account with least privilege (DISPATCHER)
      const demoUsername = (process.env.DEMO_OPERATOR_USERNAME || 'demo_operator')
        .trim()
        .toLowerCase();
      const explicitPassword = process.env.DEMO_OPERATOR_PASSWORD?.trim();
      const demoRole = 'DISPATCHER';
      const credPath = path.resolve(__dirname, '../../.demo-credentials.local.json');

      let activePassword = explicitPassword;
      const existingOp = await repo.getOperatorByUsername(demoUsername);

      if (existingOp) {
        // Strict ownership check: verify operator has durable demo ownership metadata
        const ownerCheck = await pool.query<{ is_demo: boolean; created_by_run_id: string }>(
          `SELECT is_demo, created_by_run_id FROM ${DEMO_OPERATOR_OWNERSHIP_TABLE} WHERE username = $1`,
          [demoUsername],
        );
        const isVerifiedDemoAccount = ownerCheck.rows[0]?.is_demo === true;

        if (!isVerifiedDemoAccount) {
          throw new Error(
            `DEMO_OPERATOR_COLLISION: Operator "${demoUsername}" exists but lacks demo ownership verification. ` +
              `Aborting setup to prevent mutating or deleting an unrelated account.`,
          );
        }

        // Pre-existing verified demo operator account reused across runs
        manifest.reusedOperatorUsernames.push(demoUsername);
        manifest.operatorUsernames.push(demoUsername);

        // If no explicit password provided, check if valid saved credentials exist
        if (!activePassword && fs.existsSync(credPath)) {
          try {
            const savedCreds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
            if (
              savedCreds.username === demoUsername &&
              typeof savedCreds.password === 'string' &&
              authService.verifyPassword(
                savedCreds.password,
                existingOp.salt,
                existingOp.password_hash,
              )
            ) {
              activePassword = savedCreds.password;
              console.log(
                `✔ Preserved existing verified credentials for demonstration operator "${demoUsername}".`,
              );
            }
          } catch {
            // File corrupted or unreadable; fall through to rotate
          }
        }

        // If activePassword is still not set or differs from DB, rotate/sync password
        if (!activePassword) {
          activePassword = crypto.randomBytes(16).toString('base64url');
          const { hash, salt } = authService.hashPassword(activePassword);
          await repo.updateOperatorPassword(existingOp.id, hash, salt);
          console.log(`✔ Rotated password for existing demonstration operator "${demoUsername}".`);
        } else if (
          explicitPassword &&
          !authService.verifyPassword(explicitPassword, existingOp.salt, existingOp.password_hash)
        ) {
          const { hash, salt } = authService.hashPassword(explicitPassword);
          await repo.updateOperatorPassword(existingOp.id, hash, salt);
          console.log(
            `✔ Synchronized explicit DEMO_OPERATOR_PASSWORD for operator "${demoUsername}".`,
          );
        } else {
          console.log(`✔ Demonstration operator "${demoUsername}" verified.`);
        }
      } else {
        activePassword = activePassword || crypto.randomBytes(16).toString('base64url');
        await authService.createOperator({
          username: demoUsername,
          password: activePassword,
          name: 'Lead Disaster Operations Dispatcher',
          role: demoRole,
        });

        // Record durable demo ownership metadata
        await pool.query(
          `INSERT INTO ${DEMO_OPERATOR_OWNERSHIP_TABLE} (username, created_by_run_id, is_demo)
           VALUES ($1, $2, true)
           ON CONFLICT (username) DO NOTHING`,
          [demoUsername, runId],
        );

        manifest.createdOperatorUsernames.push(demoUsername);
        manifest.operatorUsernames.push(demoUsername);
        console.log(
          `✔ Provisioned demonstration operator: "${demoUsername}" (Least-privilege role: ${demoRole}).`,
        );
      }

      await recordDemoRunManifest(pool, manifest);

      // Persist credentials locally in gitignored file — NEVER print password to stdout
      fs.writeFileSync(
        credPath,
        JSON.stringify(
          {
            username: demoUsername,
            password: activePassword,
            role: demoRole,
            runId,
            generatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      console.log(`✔ Credentials securely written to local file: .demo-credentials.local.json`);

      // Verify immediately via authService.authenticate
      const authVerification = await authService.authenticate(demoUsername, activePassword);
      if (!authVerification.token) {
        throw new Error(
          `CRITICAL: Demonstration operator authentication verification failed for "${demoUsername}"`,
        );
      }
      console.log(`✔ Demonstration operator credentials verified via authentication check.`);

      // Step 6: Propose baseline assignment
      console.log('Generating initial baseline rescue proposal (algorithm: savings)...');
      const baseline = await assignmentService.proposeAssignment({
        scenarioId: scenario.id,
        algorithm: 'savings',
      });
      manifest.assignmentIds.push(baseline.id);
      const baselineWithStops = await repo.getAssignmentWithStops(baseline.id);
      if (baselineWithStops) {
        for (const stop of baselineWithStops.stops) {
          manifest.assignmentStopIds.push(stop.id);
        }
      }
      await recordDemoRunManifest(pool, manifest);
      console.log(`✔ Baseline proposal created: ID = ${baseline.id}`);

      // Step 7: Baseline assignment handling (Simulation Preview Mode vs Operational Commitment)
      const isSimulatedScenario =
        scenario.requests.some((r) => r.source === 'SIMULATED') ||
        scenario.resources.some((r) => r.source === 'SIMULATED');

      let frozenStopsCount = 0;
      if (isSimulatedScenario) {
        console.log('ℹ Simulation Preview Mode: Baseline proposal retained in PROPOSED status.');
        console.log(
          '  (PR #41 operational provenance rules prevent committing synthetic data to operational dispatch; real-world requests require human operator commitment).',
        );
      } else {
        console.log('Operator committing baseline assignment (freezing mission stops)...');
        const commitSuccess = await assignmentService.commitAssignment(baseline.id, {
          operatorId: demoUsername,
          notes: 'Baseline Yamuna disaster relief deployment plan committed by demo operator.',
        });
        if (!commitSuccess) {
          throw new Error(`Failed to commit baseline assignment "${baseline.id}"`);
        }

        const committedAssignment = await repo.getAssignmentWithStops(baseline.id);
        const frozenStops = committedAssignment?.stops.filter((s) => s.is_frozen) ?? [];
        frozenStopsCount = frozenStops.length;
        console.log(
          `✔ Baseline committed: status = ${committedAssignment?.assignment.status}, frozen stops = ${frozenStopsCount}.`,
        );
      }

      // Step 8: Inject operational disruptions
      // A. Resource offline disruption
      console.log('Injecting operational disruption 1: Craft engine failure (RESOURCE_OFFLINE)...');
      const offlineResource = await repo.updateResourceStatus('demo-res-boat-01', 'OFFLINE');
      if (!offlineResource) {
        // If resource is simulated, repo.updateResourceStatus strictly enforces source = 'REAL' per ADR-41.
        // For demonstration/simulation fixtures, update status directly in PostgreSQL.
        const resUpdate = await pool.query(
          `UPDATE resources SET status = 'OFFLINE', updated_at = NOW() WHERE id = $1 RETURNING id`,
          ['demo-res-boat-01'],
        );
        if (resUpdate.rowCount === 0) {
          throw new Error('Could not find resource demo-res-boat-01 to mark OFFLINE');
        }
      }

      const disruptionEvent = await eventService.recordEvent({
        id: `evt-demo-disrupt-${Date.now().toString().slice(-4)}`,
        type: 'RESOURCE_OFFLINE',
        entityType: 'RESOURCE',
        entityId: 'demo-res-boat-01',
        actorId: demoUsername,
        actorType: 'OPERATOR',
        payload: {
          resourceId: 'demo-res-boat-01',
          previousStatus: 'AVAILABLE',
          newStatus: 'OFFLINE',
          reason: 'Outboard motor flooded in high-turbidity debris water near Old Railway Bridge',
        },
      });
      manifest.operationalEventIds.push(disruptionEvent.event.id);
      console.log(
        `✔ Recorded disruption event: ID = ${disruptionEvent.event.id} (RESOURCE_OFFLINE)`,
      );

      // B. Road blockage hazard
      console.log('Injecting operational disruption 2: Submerged underpass (ROAD_BLOCKED)...');
      const blockedZone = await repo.insertBlockedZone({
        id: 'demo-zone-submerged-bypass',
        name: 'Ring Road Submerged Underpass',
        severity: 'BLOCKED',
        polygon: [
          { lat: 28.662, lng: 77.24 },
          { lat: 28.665, lng: 77.245 },
          { lat: 28.661, lng: 77.247 },
          { lat: 28.658, lng: 77.242 },
        ],
        createdBy: demoUsername,
      });
      manifest.blockedZoneIds.push(blockedZone.id);

      const hazardEvent = await eventService.recordEvent({
        id: `evt-demo-hazard-${Date.now().toString().slice(-4)}`,
        type: 'ROAD_BLOCKED',
        entityType: 'ROAD_ZONE',
        entityId: blockedZone.id,
        actorId: demoUsername,
        actorType: 'OPERATOR',
        payload: {
          zoneId: blockedZone.id,
          name: blockedZone.name,
          severity: blockedZone.severity,
        },
      });
      manifest.operationalEventIds.push(hazardEvent.event.id);
      await recordDemoRunManifest(pool, manifest);
      console.log(`✔ Recorded hazard zone: ID = ${blockedZone.id} (ROAD_BLOCKED)`);

      // Step 9: Incremental plan repair
      if (isSimulatedScenario) {
        console.log(
          'Invoking simulation preview repair orchestration (evaluating route re-optimization under resource disruption)...',
        );
      } else {
        console.log('Invoking incremental repair orchestration with frozen stop preservation...');
      }
      const repairResult = await repairService.orchestrateRepair(disruptionEvent.event.id, {
        baselineAssignmentId: baseline.id,
      });

      if (repairResult.proposalId) {
        manifest.assignmentIds.push(repairResult.proposalId);
        const repairedPlan = await repo.getAssignmentWithStops(repairResult.proposalId);
        if (repairedPlan) {
          for (const stop of repairedPlan.stops) {
            manifest.assignmentStopIds.push(stop.id);
          }
        }
      }

      console.log(`✔ Incremental repair complete:`);
      console.log(`  - Status:                   ${repairResult.status}`);
      console.log(`  - Repaired Proposal ID:     ${repairResult.proposalId ?? 'N/A'}`);
      console.log(`  - Frozen Stops Violated:    ${repairResult.churn?.frozenStopsViolated ?? 0}`);
      console.log(
        `  - Reassigned Requests:      ${repairResult.churn?.reassignedRequestsCount ?? 0}`,
      );
      console.log(`  - Route Churn Score:        ${repairResult.churn?.churnRate ?? 0}`);

      if ((repairResult.churn?.frozenStopsViolated ?? 0) > 0) {
        throw new Error('SAFETY VIOLATION: Repair violated committed frozen stops!');
      }

      // Step 10: Persist durable run manifest in PostgreSQL as ACTIVE
      manifest.status = 'ACTIVE';
      await recordDemoRunManifest(pool, manifest);
      console.log(`✔ Durable demo manifest recorded: Run ID = ${runId} (Status: ACTIVE)`);

      // Step 11: Print interactive demonstration guide
      console.log('\n===============================================================');
      console.log('🎉 FloodRelay Demonstration System Ready for Presentation');
      console.log('===============================================================');
      if (isSimulatedScenario) {
        console.log('  Mode:     Simulation Preview (Synthetic entities held in PROPOSED status)');
      } else {
        console.log('  Mode:     Operational Dispatch (Committed)');
      }
      console.log('\nOperator Credentials:');
      console.log(`  Username: ${demoUsername}`);
      console.log(`  Role:     ${demoRole}`);
      console.log(`  Password: [PROTECTED] View via: npm run demo:credentials`);
      console.log('\nInteractive Web Applications:');
      console.log('  1. Citizen Distress Intake:   http://localhost:3000/citizen/request');
      console.log('  2. Operator Command Portal:   http://localhost:3000/operator');
      console.log('  3. Tactical GIS Live Map:     http://localhost:3000/operator/map');
      console.log('  4. Operational Audit Log:     http://localhost:3000/operator/audit');
      console.log('  5. Platform Limitations:      http://localhost:3000/limitations');
      console.log('\nBackend Health & Specifications:');
      console.log('  - API Health:                 http://localhost:3000/health');
      console.log('  - OpenAPI Specification:      http://localhost:3000/openapi.json');
      console.log('  - River Forecast Context:     http://localhost:3000/forecast/context');
      console.log('\nCleanup Command:');
      console.log('  npm run demo:cleanup\n');

      return {
        runId,
        scenarioId: scenario.id,
        baselineAssignmentId: baseline.id,
        repairedProposalId: repairResult.proposalId ?? '',
        disruptionEventId: disruptionEvent.event.id,
        frozenStopsCount,
        churnRate: repairResult.churn?.churnRate ?? 0,
        credentialsFile: credPath,
        isSimulationPreview: isSimulatedScenario,
      };
    } catch (stepErr) {
      manifest.status = 'FAILED';
      await recordDemoRunManifest(pool, manifest).catch(() => {});
      console.warn(`[Demo Setup Failure] Attempting automated rollback of owned run "${runId}"...`);
      await cleanupTrackedDemoFixtures(pool, runId).catch((cleanupErr) => {
        console.warn('Failed to clean up partial demo run after failure:', cleanupErr);
      });
      throw stepErr;
    }
  } finally {
    if (options?.closePool ?? process.argv[1] === fileURLToPath(import.meta.url)) {
      await closePool();
    }
  }
}

// Execute when invoked directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runDemoSetup()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Demo setup failed:', err);
      process.exit(1);
    });
}
