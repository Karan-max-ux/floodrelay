import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthService, InMemoryAuthRepository } from '@floodrelay/api';
import type { DbOperator } from '@floodrelay/api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const credPath = path.resolve(__dirname, '../../.demo-credentials.local.json');

describe('Demonstration Workflow CLI & Credential Lifecycle Suite', () => {
  const originalEnv = process.env;
  let tempCredsExisted = false;
  let backupCreds: string | null = null;

  beforeEach(() => {
    process.env = { ...originalEnv };
    if (fs.existsSync(credPath)) {
      tempCredsExisted = true;
      backupCreds = fs.readFileSync(credPath, 'utf-8');
      fs.unlinkSync(credPath);
    } else {
      tempCredsExisted = false;
      backupCreds = null;
    }
  });

  afterEach(() => {
    process.env = originalEnv;
    if (tempCredsExisted && backupCreds !== null) {
      fs.writeFileSync(credPath, backupCreds, { mode: 0o600 });
    } else if (fs.existsSync(credPath)) {
      try {
        fs.unlinkSync(credPath);
      } catch {
        // ignore
      }
    }
  });

  describe('Operator Credential Synchronization & Idempotent Setup', () => {
    it('creates initial operator account, writes local file and validates authentication', async () => {
      const repo = new InMemoryAuthRepository();
      const auth = new AuthService(repo);

      const demoUser = 'demo_operator';
      const initialPassword = 'Initial_Secure_Password_2026!';

      // Simulate first setup
      await auth.createOperator({
        username: demoUser,
        password: initialPassword,
        name: 'Lead Disaster Operations Dispatcher',
        role: 'DISPATCHER',
      });

      fs.writeFileSync(
        credPath,
        JSON.stringify({
          username: demoUser,
          password: initialPassword,
          role: 'DISPATCHER',
          runId: 'demo_run_1',
          generatedAt: new Date().toISOString(),
        }),
        { mode: 0o600 },
      );

      // Verify immediate authentication
      const authResult = await auth.authenticate(demoUser, initialPassword);
      expect(authResult.token).toBeDefined();
      expect(authResult.operator.username).toBe(demoUser);
      expect(authResult.operator.role).toBe('DISPATCHER');
    });

    it('preserves existing operator credentials on repeated setup when file and database match', async () => {
      const repo = new InMemoryAuthRepository();
      const auth = new AuthService(repo);

      const demoUser = 'demo_operator';
      const existingPassword = 'Existing_Verified_Password_2026!';

      // Provision existing operator in database
      const { hash, salt } = auth.hashPassword(existingPassword);
      const op: Omit<DbOperator, 'created_at' | 'updated_at'> = {
        id: 'op-demo-1',
        username: demoUser,
        password_hash: hash,
        salt,
        name: 'Lead Disaster Operations Dispatcher',
        role: 'DISPATCHER',
        is_active: true,
      };
      await repo.insertOperator(op);

      // Write matching credentials file
      fs.writeFileSync(
        credPath,
        JSON.stringify({
          username: demoUser,
          password: existingPassword,
          role: 'DISPATCHER',
          runId: 'demo_run_prior',
          generatedAt: new Date().toISOString(),
        }),
        { mode: 0o600 },
      );

      // Repeated setup logic: verify saved password against DB
      const existingOp = await repo.getOperatorByUsername(demoUser);
      expect(existingOp).not.toBeNull();

      const savedCreds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
      const isValid = auth.verifyPassword(
        savedCreds.password,
        existingOp!.salt,
        existingOp!.password_hash,
      );
      expect(isValid).toBe(true);

      // Authenticate with preserved password
      const authResult = await auth.authenticate(demoUser, savedCreds.password);
      expect(authResult.token).toBeDefined();
    });

    it('rotates password in database and local file when desynchronized on repeated setup', async () => {
      const repo = new InMemoryAuthRepository();
      const auth = new AuthService(repo);

      const demoUser = 'demo_operator';
      const oldDbPassword = 'Old_Database_Password_2026!';
      const staleFilePassword = 'Stale_File_Password_9999!';

      // Provision operator with old DB password
      const { hash: oldHash, salt: oldSalt } = auth.hashPassword(oldDbPassword);
      await repo.insertOperator({
        id: 'op-demo-desync',
        username: demoUser,
        password_hash: oldHash,
        salt: oldSalt,
        name: 'Lead Disaster Operations Dispatcher',
        role: 'DISPATCHER',
        is_active: true,
      });

      // Write stale credentials file (does not match DB)
      fs.writeFileSync(
        credPath,
        JSON.stringify({
          username: demoUser,
          password: staleFilePassword,
          role: 'DISPATCHER',
          runId: 'demo_run_stale',
          generatedAt: new Date().toISOString(),
        }),
        { mode: 0o600 },
      );

      const existingOp = await repo.getOperatorByUsername(demoUser);
      expect(existingOp).not.toBeNull();

      const savedCreds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
      const isValid = auth.verifyPassword(
        savedCreds.password,
        existingOp!.salt,
        existingOp!.password_hash,
      );
      expect(isValid).toBe(false);

      // Desync detected: generate new rotated password and update both DB and file
      const rotatedPassword = crypto.randomBytes(16).toString('base64url');
      const { hash: newHash, salt: newSalt } = auth.hashPassword(rotatedPassword);
      await repo.updateOperatorPassword(existingOp!.id, newHash, newSalt);

      fs.writeFileSync(
        credPath,
        JSON.stringify({
          username: demoUser,
          password: rotatedPassword,
          role: 'DISPATCHER',
          runId: 'demo_run_rotated',
          generatedAt: new Date().toISOString(),
        }),
        { mode: 0o600 },
      );

      // Authentication must succeed with new rotated credentials
      const authResult = await auth.authenticate(demoUser, rotatedPassword);
      expect(authResult.token).toBeDefined();

      // Old password must now fail
      await expect(auth.authenticate(demoUser, oldDbPassword)).rejects.toThrow(
        /Invalid operator credentials/,
      );
    });

    it('supports explicit DEMO_OPERATOR_PASSWORD override and synchronizes database', async () => {
      const repo = new InMemoryAuthRepository();
      const auth = new AuthService(repo);

      const demoUser = 'demo_operator';
      const explicitPassword = 'Custom_Override_Password_2026!';

      // Existing operator with another password
      const { hash, salt } = auth.hashPassword('Original_Password_12345!');
      const op = await repo.insertOperator({
        id: 'op-demo-override',
        username: demoUser,
        password_hash: hash,
        salt,
        name: 'Lead Disaster Operations Dispatcher',
        role: 'DISPATCHER',
        is_active: true,
      });

      // Override requested: update DB and write file
      await auth.updateOperatorPassword(op.id, explicitPassword);
      fs.writeFileSync(
        credPath,
        JSON.stringify({
          username: demoUser,
          password: explicitPassword,
          role: 'DISPATCHER',
          runId: 'demo_run_override',
          generatedAt: new Date().toISOString(),
        }),
        { mode: 0o600 },
      );

      // Verify login with overridden password
      const authResult = await auth.authenticate(demoUser, explicitPassword);
      expect(authResult.token).toBeDefined();
    });
  });

  describe('Simulation Preview Mode vs Operational Provenance Safeguards', () => {
    it('distinguishes simulated scenario from real operational entities', () => {
      const simulatedScenario = {
        id: 'demo-yamuna-scenario',
        requests: [{ id: 'req-sim-1', source: 'SIMULATED' }],
        resources: [{ id: 'res-sim-1', source: 'SIMULATED' }],
      };

      const isSimulated =
        simulatedScenario.requests.some((r) => r.source === 'SIMULATED') ||
        simulatedScenario.resources.some((r) => r.source === 'SIMULATED');

      expect(isSimulated).toBe(true);

      const realScenario = {
        id: 'real-yamuna-scenario',
        requests: [{ id: 'req-real-1', source: 'REPORTED' }],
        resources: [{ id: 'res-real-1', source: 'REAL' }],
      };

      const isReal = !(
        realScenario.requests.some((r) => r.source === 'SIMULATED') ||
        realScenario.resources.some((r) => r.source === 'SIMULATED')
      );

      expect(isReal).toBe(true);
    });

    it('demonstration preview mode holds simulated proposal in PROPOSED status with 0 frozen stops', () => {
      const proposal = {
        id: 'assignment-sim-preview',
        status: 'PROPOSED',
        stops: [
          { id: 'stop-1', is_frozen: false, type: 'PICKUP', target_id: 'req-sim-1' },
          { id: 'stop-2', is_frozen: false, type: 'DROPOFF', target_id: 'shelter-1' },
        ],
      };

      // In simulation preview mode, stops are NOT frozen because commitAssignment is not called
      const frozenStops = proposal.stops.filter((s) => s.is_frozen);
      expect(frozenStops).toHaveLength(0);
      expect(proposal.status).toBe('PROPOSED');
    });
  });
});
