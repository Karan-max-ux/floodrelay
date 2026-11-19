import crypto from 'node:crypto';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createApp } from '../app.js';
import { AuthService, InMemoryAuthRepository } from '../services/authService.js';
import { PostgisRepository, type Queryable } from '../db/repository.js';
import { RequestService } from '../services/requestService.js';
import { AssignmentService } from '../services/assignmentService.js';
import type { DbRequest } from '../db/schema.js';
import { handleMockServiceAreaQuery } from '../geo/mockServiceAreaQuery.js';

class MockQueryable implements Queryable {
  public requests = new Map<string, DbRequest>();

  async query<R extends Record<string, unknown> = Record<string, unknown>>(
    sqlOrConfig: string | { text: string; values?: unknown[] },
    values?: unknown[],
  ): Promise<{ rows: R[]; command: string; rowCount: number; oid: number; fields: [] }> {
    const sql = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text;
    const vals = values ?? (sqlOrConfig as { values?: unknown[] }).values ?? [];

    const serviceAreaRes = handleMockServiceAreaQuery<R>(sql, vals);
    if (serviceAreaRes) {
      return serviceAreaRes;
    }

    if (sql.includes('INSERT INTO requests')) {
      const id = vals[0] as string;
      const req: DbRequest = {
        id,
        location: `POINT(${vals[1]} ${vals[2]})`,
        people_count: vals[3] as number,
        urgency: vals[4] as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
        source: 'REPORTED',
        status: 'PENDING',
        verification_status: 'UNVERIFIED',
        medical_needs: Boolean(vals[8]),
        notes: (vals[9] as string) || null,
        idempotency_key: (vals[10] as string) || null,
        idempotency_request_hash: (vals[11] as string) || null,
        duplicate_of_id: (vals[12] as string) || null,
        is_flagged_duplicate: Boolean(vals[13]),
        created_at: new Date(),
        updated_at: new Date(),
      };
      this.requests.set(id, req);
      return { rows: [req as unknown as R], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
    }

    if (sql.includes('SELECT') && sql.includes('FROM requests') && sql.includes('WHERE id = $1')) {
      const id = vals[0] as string;
      const req = this.requests.get(id);
      return {
        rows: req ? [req as unknown as R] : [],
        command: 'SELECT',
        rowCount: req ? 1 : 0,
        oid: 0,
        fields: [],
      };
    }

    if (sql.includes('SELECT') && sql.includes('FROM requests')) {
      return {
        rows: Array.from(this.requests.values()) as unknown as R[],
        command: 'SELECT',
        rowCount: this.requests.size,
        oid: 0,
        fields: [],
      };
    }

    if (sql.includes('INSERT INTO operational_events')) {
      const id = vals[0] as string;
      const row = {
        id,
        event_type: vals[1],
        entity_type: vals[2],
        entity_id: vals[3],
        actor_id: vals[4] || null,
        actor_type: vals[5],
        payload: JSON.parse((vals[6] as string) || '{}'),
        correlation_id: vals[7] || null,
        idempotency_key: vals[8] || null,
        entity_version: vals[9] || 1,
        processing_status: vals[10] || 'RECORDED',
        processing_attempts: vals[11] || 0,
        last_error_code: vals[12] || null,
        occurred_at: vals[13] || new Date(),
        created_at: new Date(),
        processed_at: vals[14] || null,
      };
      return { rows: [row as unknown as R], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
    }

    if (sql.includes('INSERT INTO audit_events')) {
      return { rows: [], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
    }

    if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK')) {
      return { rows: [], command: 'TX', rowCount: 0, oid: 0, fields: [] };
    }

    return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
  }
}

describe('Operator Authentication & API Protection Suite', () => {
  let inMemoryAuthRepo: InMemoryAuthRepository;
  let authService: AuthService;
  let mockDb: MockQueryable;
  let repo: PostgisRepository;
  let requestService: RequestService;
  let assignmentService: AssignmentService;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    inMemoryAuthRepo = new InMemoryAuthRepository();
    authService = new AuthService(inMemoryAuthRepo);
    mockDb = new MockQueryable();
    repo = new PostgisRepository(mockDb as unknown as import('pg').Pool);
    requestService = new RequestService(repo);
    assignmentService = new AssignmentService(repo);

    // Create a known operator
    await authService.createOperator({
      username: 'eoc_test_operator',
      password: 'SecureOperatorPassword123!',
      name: 'Capt. R. Vance',
      role: 'OPERATOR',
    });

    app = createApp({
      repository: repo,
      authService,
      requestService,
      assignmentService,
    });
  });

  describe('POST /auth/login', () => {
    it('rejects login with missing username or password', async () => {
      const res = await request(app).post('/auth/login').send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects login with non-existent operator', async () => {
      const res = await request(app).post('/auth/login').send({
        username: 'unknown_operator',
        password: 'Password123!',
      });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects login with incorrect password', async () => {
      const res = await request(app).post('/auth/login').send({
        username: 'eoc_test_operator',
        password: 'WrongPassword456!',
      });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('successfully logs in with valid credentials and sets session cookie', async () => {
      const res = await request(app).post('/auth/login').send({
        username: 'eoc_test_operator',
        password: 'SecureOperatorPassword123!',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.operator.username).toBe('eoc_test_operator');
      expect(res.body.data.operator.name).toBe('Capt. R. Vance');

      // Verify Set-Cookie header
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieStr = Array.isArray(cookies) ? cookies.join(';') : String(cookies);
      expect(cookieStr).toContain('floodrelay_session=');
      expect(cookieStr).toContain('HttpOnly');
    });

    it('rejects login when operator is inactive with HTTP 401', async () => {
      await inMemoryAuthRepo.insertOperator({
        id: 'op-inactive-01',
        username: 'inactive_operator',
        password_hash: authService.hashPassword('Password123!').hash,
        salt: authService.hashPassword('Password123!').salt,
        name: 'Inactive Responder',
        role: 'OPERATOR',
        is_active: false,
      });

      const res = await request(app).post('/auth/login').send({
        username: 'inactive_operator',
        password: 'Password123!',
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('enforces rate limiting after 5 consecutive failed attempts', async () => {
      for (let i = 0; i < 5; i++) {
        const failRes = await request(app).post('/auth/login').send({
          username: 'eoc_test_operator',
          password: 'IncorrectPassword',
        });
        expect(failRes.status).toBe(401);
      }

      // 6th attempt should be blocked by rate limiter
      const lockedRes = await request(app).post('/auth/login').send({
        username: 'eoc_test_operator',
        password: 'SecureOperatorPassword123!', // Even with correct password
      });
      expect(lockedRes.status).toBe(429);
      expect(lockedRes.body.error.code).toBe('RATE_LIMITED');
    });

    it('handles database unavailability safely with HTTP 503 DATABASE_UNAVAILABLE', async () => {
      const failingRepo = new InMemoryAuthRepository();
      failingRepo.getOperatorByUsername = async () => {
        const connErr = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
          code: 'ECONNREFUSED',
        });
        throw connErr;
      };

      const failingAuth = new AuthService(failingRepo);
      const testApp = createApp({
        repository: repo,
        authService: failingAuth,
        requestService,
        assignmentService,
      });

      const res = await request(testApp).post('/auth/login').send({
        username: 'eoc_test_operator',
        password: 'SecureOperatorPassword123!',
      });

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('DATABASE_UNAVAILABLE');
      expect(res.body.error.message).toContain('Database is currently unavailable');
      expect(res.body.error.message).not.toContain('ECONNREFUSED');
      expect(res.body.error.message).not.toContain('127.0.0.1');
    });

    it('handles missing database schema with HTTP 503 SCHEMA_ERROR and actionable diagnostic', async () => {
      const failingRepo = new InMemoryAuthRepository();
      failingRepo.getOperatorByUsername = async () => {
        const schemaErr = Object.assign(new Error('relation "operators" does not exist'), {
          code: '42P01',
        });
        throw schemaErr;
      };

      const failingAuth = new AuthService(failingRepo);
      const testApp = createApp({
        repository: repo,
        authService: failingAuth,
        requestService,
        assignmentService,
      });

      const res = await request(testApp).post('/auth/login').send({
        username: 'eoc_test_operator',
        password: 'SecureOperatorPassword123!',
      });

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('SCHEMA_ERROR');
      expect(res.body.error.message).toContain('Authentication schema is not initialized');
      expect(res.body.error.message).not.toContain('relation "operators"');
    });
  });

  describe('GET /auth/me & Session Verification', () => {
    it('returns 401 UNAUTHORIZED when no token or cookie is supplied', async () => {
      const res = await request(app).get('/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 SESSION_EXPIRED when an invalid token is provided', async () => {
      const res = await request(app)
        .get('/auth/me')
        .set(
          'Authorization',
          'Bearer 0000000000000000000000000000000000000000000000000000000000000000',
        );
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('SESSION_EXPIRED');
    });

    it('returns operator profile when authenticated via Bearer token', async () => {
      const loginRes = await request(app).post('/auth/login').send({
        username: 'eoc_test_operator',
        password: 'SecureOperatorPassword123!',
      });
      const token = loginRes.body.data.token;

      const meRes = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.success).toBe(true);
      expect(meRes.body.data.operator.username).toBe('eoc_test_operator');
    });

    it('returns operator profile when authenticated via cookie', async () => {
      const loginRes = await request(app).post('/auth/login').send({
        username: 'eoc_test_operator',
        password: 'SecureOperatorPassword123!',
      });
      const cookie = loginRes.headers['set-cookie'] || [];
      const cookieHeader = Array.isArray(cookie) ? cookie : [String(cookie)];

      const meRes = await request(app).get('/auth/me').set('Cookie', cookieHeader);

      expect(meRes.status).toBe(200);
      expect(meRes.body.success).toBe(true);
      expect(meRes.body.data.operator.username).toBe('eoc_test_operator');
    });

    it('handles database connection failure during session validation with HTTP 503 DATABASE_UNAVAILABLE', async () => {
      const failingRepo = new InMemoryAuthRepository();
      failingRepo.getSessionWithOperator = async () => {
        const connErr = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
          code: 'ECONNREFUSED',
        });
        throw connErr;
      };

      const failingAuth = new AuthService(failingRepo);
      const testApp = createApp({
        repository: repo,
        authService: failingAuth,
        requestService,
        assignmentService,
      });

      const res = await request(testApp)
        .get('/auth/me')
        .set(
          'Authorization',
          'Bearer 1111111111111111111111111111111111111111111111111111111111111111',
        );

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('DATABASE_UNAVAILABLE');
      expect(res.body.error.message).toContain('database connectivity issues');
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes session and subsequent requests fail', async () => {
      const loginRes = await request(app).post('/auth/login').send({
        username: 'eoc_test_operator',
        password: 'SecureOperatorPassword123!',
      });
      const token = loginRes.body.data.token;

      // Logout
      const logoutRes = await request(app)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${token}`);
      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);

      // Verify session is now invalid
      const meRes = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);
      expect(meRes.status).toBe(401);
    });
  });

  describe('API Route Protection & Public Boundary Enforcement', () => {
    it('keeps POST /requests (Citizen Portal) open to anonymous callers', async () => {
      const res = await request(app).post('/requests').send({
        lat: 28.6139,
        lng: 77.209,
        peopleCount: 2,
        urgency: 'HIGH',
      });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
    });

    it('blocks anonymous access to GET /requests with 401 UNAUTHORIZED', async () => {
      const res = await request(app).get('/requests');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('allows authenticated operator access to GET /requests', async () => {
      const loginRes = await request(app).post('/auth/login').send({
        username: 'eoc_test_operator',
        password: 'SecureOperatorPassword123!',
      });
      const token = loginRes.body.data.token;

      const res = await request(app).get('/requests').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('blocks anonymous access to GET /requests/:id with 401 UNAUTHORIZED', async () => {
      const res = await request(app).get('/requests/req-sample-id');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('blocks anonymous access to GET /assignments with 401 UNAUTHORIZED', async () => {
      const res = await request(app).get('/assignments');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('keeps GET /health publicly accessible without auth', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('keeps GET /openapi.json publicly accessible without auth', async () => {
      const res = await request(app).get('/openapi.json');
      expect(res.status).toBe(200);
      expect(res.body.openapi).toBeDefined();
    });
  });

  describe('Operator Provisioning & Production Security Invariants', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('strictly forbids login with default development password in production environment', async () => {
      process.env.NODE_ENV = 'production';
      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'test_operator', password: 'RescueOps@2026!' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('DEFAULT_CREDENTIALS_PROHIBITED');
    });

    it('provisions development operator in non-production when database is empty', async () => {
      delete process.env.NODE_ENV;
      delete process.env.INITIAL_OPERATOR_USERNAME;
      delete process.env.INITIAL_OPERATOR_PASSWORD;
      const freshRepo = new InMemoryAuthRepository();
      const freshAuth = new AuthService(freshRepo);
      await freshAuth.ensureInitialOperator();

      const count = await freshRepo.countOperators();
      expect(count).toBe(1);
      const op = await freshRepo.getOperatorByUsername('eoc_operator');
      expect(op).toBeDefined();
      expect(op?.role).toBe('ADMIN');
    });

    it('does not provision default operator in production when credentials are not configured', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.INITIAL_OPERATOR_USERNAME;
      delete process.env.INITIAL_OPERATOR_PASSWORD;
      const freshRepo = new InMemoryAuthRepository();
      const freshAuth = new AuthService(freshRepo);
      await freshAuth.ensureInitialOperator();

      const count = await freshRepo.countOperators();
      expect(count).toBe(0);
    });

    it('throws security violation error if default password is configured as INITIAL_OPERATOR_PASSWORD in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.INITIAL_OPERATOR_USERNAME = 'prod_operator';
      process.env.INITIAL_OPERATOR_PASSWORD = 'RescueOps@2026!';
      const freshRepo = new InMemoryAuthRepository();
      const freshAuth = new AuthService(freshRepo);

      await expect(freshAuth.ensureInitialOperator()).rejects.toThrow(
        /Default development password "RescueOps@2026!" cannot be used as INITIAL_OPERATOR_PASSWORD in production/,
      );
    });

    it('successfully provisions operator in production when secure custom credentials are provided', async () => {
      process.env.NODE_ENV = 'production';
      process.env.INITIAL_OPERATOR_USERNAME = 'secure_admin';
      process.env.INITIAL_OPERATOR_PASSWORD = 'CustomProdPassword2026!#';
      process.env.INITIAL_OPERATOR_NAME = 'Duty Director';
      const freshRepo = new InMemoryAuthRepository();
      const freshAuth = new AuthService(freshRepo);
      await freshAuth.ensureInitialOperator();

      const count = await freshRepo.countOperators();
      expect(count).toBe(1);
      const op = await freshRepo.getOperatorByUsername('secure_admin');
      expect(op).toBeDefined();
      expect(op?.name).toBe('Duty Director');

      // Operator can authenticate with custom credentials
      const session = await freshAuth.authenticate('secure_admin', 'CustomProdPassword2026!#');
      expect(session.operator.username).toBe('secure_admin');
    });

    it('verifies existing operator with matching configured credentials without modifying password hash or salt', async () => {
      delete process.env.NODE_ENV;
      const initialUser = 'matched_admin';
      const initialPass = 'MatchedSecurePass2026!';
      process.env.INITIAL_OPERATOR_USERNAME = initialUser;
      process.env.INITIAL_OPERATOR_PASSWORD = initialPass;

      const freshRepo = new InMemoryAuthRepository();
      const freshAuth = new AuthService(freshRepo);

      // Pre-seed operator
      await freshAuth.createOperator({
        username: initialUser,
        password: initialPass,
        name: 'Pre-existing Admin',
        role: 'ADMIN',
      });

      const beforeOp = await freshRepo.getOperatorByUsername(initialUser);
      expect(beforeOp).toBeDefined();
      const originalHash = beforeOp!.password_hash;
      const originalSalt = beforeOp!.salt;
      const originalUpdatedAt = beforeOp!.updated_at;

      // Run ensureInitialOperator with matching credentials
      await freshAuth.ensureInitialOperator();

      const afterOp = await freshRepo.getOperatorByUsername(initialUser);
      expect(afterOp!.password_hash).toBe(originalHash);
      expect(afterOp!.salt).toBe(originalSalt);
      expect(afterOp!.updated_at.getTime()).toBe(originalUpdatedAt.getTime());

      // Operator authenticates normally
      const session = await freshAuth.authenticate(initialUser, initialPass);
      expect(session.operator.username).toBe(initialUser);
    });

    it('rejects startup and preserves original credentials when existing operator has mismatched configured credentials', async () => {
      delete process.env.NODE_ENV;
      const initialUser = 'protected_admin';
      const originalPass = 'OriginalCorrectPass2026!';
      const mismatchedPass = 'UnintendedMismatchedPass2026!';

      const freshRepo = new InMemoryAuthRepository();
      const freshAuth = new AuthService(freshRepo);

      // Pre-seed operator with original credentials
      await freshAuth.createOperator({
        username: initialUser,
        password: originalPass,
        name: 'Protected Lead Officer',
        role: 'DISPATCHER',
      });

      const beforeOp = await freshRepo.getOperatorByUsername(initialUser);
      expect(beforeOp).toBeDefined();
      const originalHash = beforeOp!.password_hash;
      const originalSalt = beforeOp!.salt;
      const originalRole = beforeOp!.role;
      const originalName = beforeOp!.name;

      // Configure mismatched password
      process.env.INITIAL_OPERATOR_USERNAME = initialUser;
      process.env.INITIAL_OPERATOR_PASSWORD = mismatchedPass;

      // Must throw controlled security violation error
      await expect(freshAuth.ensureInitialOperator()).rejects.toThrow(
        /Configured initial operator "protected_admin" already exists but configured password does not match stored credentials/,
      );

      // State after failed startup: MUST remain completely untouched
      const afterOp = await freshRepo.getOperatorByUsername(initialUser);
      expect(afterOp!.password_hash).toBe(originalHash);
      expect(afterOp!.salt).toBe(originalSalt);
      expect(afterOp!.role).toBe(originalRole);
      expect(afterOp!.name).toBe(originalName);

      // Original password still authenticates
      const session = await freshAuth.authenticate(initialUser, originalPass);
      expect(session.operator.username).toBe(initialUser);

      // Mismatched password MUST fail authentication
      await expect(freshAuth.authenticate(initialUser, mismatchedPass)).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
        statusCode: 401,
      });
    });

    it('preserves existing unrelated operators and their credentials when bootstrapping new operator', async () => {
      delete process.env.NODE_ENV;
      const freshRepo = new InMemoryAuthRepository();
      const freshAuth = new AuthService(freshRepo);

      // Pre-seed unrelated operators
      await freshAuth.createOperator({
        username: 'unrelated_dispatcher',
        password: 'DispatcherPass2026!',
        name: 'Field Dispatcher',
        role: 'DISPATCHER',
      });
      await freshAuth.createOperator({
        username: 'unrelated_analyst',
        password: 'AnalystPass2026!',
        name: 'GIS Analyst',
        role: 'OPERATOR',
      });

      const op1Before = await freshRepo.getOperatorByUsername('unrelated_dispatcher');
      const op2Before = await freshRepo.getOperatorByUsername('unrelated_analyst');

      // Configure new bootstrap operator
      process.env.INITIAL_OPERATOR_USERNAME = 'new_bootstrap_admin';
      process.env.INITIAL_OPERATOR_PASSWORD = 'NewBootstrapPass2026!';
      process.env.INITIAL_OPERATOR_NAME = 'Bootstrap Admin';

      await freshAuth.ensureInitialOperator();

      expect(await freshRepo.countOperators()).toBe(3);

      // Unrelated operators are completely unmodified
      const op1After = await freshRepo.getOperatorByUsername('unrelated_dispatcher');
      const op2After = await freshRepo.getOperatorByUsername('unrelated_analyst');
      expect(op1After!.password_hash).toBe(op1Before!.password_hash);
      expect(op1After!.salt).toBe(op1Before!.salt);
      expect(op1After!.role).toBe('DISPATCHER');
      expect(op2After!.password_hash).toBe(op2Before!.password_hash);
      expect(op2After!.salt).toBe(op2Before!.salt);
      expect(op2After!.role).toBe('OPERATOR');

      // Both unrelated operators authenticate with original passwords
      const s1 = await freshAuth.authenticate('unrelated_dispatcher', 'DispatcherPass2026!');
      expect(s1.operator.username).toBe('unrelated_dispatcher');
      const s2 = await freshAuth.authenticate('unrelated_analyst', 'AnalystPass2026!');
      expect(s2.operator.username).toBe('unrelated_analyst');

      // New operator also authenticates
      const s3 = await freshAuth.authenticate('new_bootstrap_admin', 'NewBootstrapPass2026!');
      expect(s3.operator.username).toBe('new_bootstrap_admin');
    });

    it('provisions and authenticates CI operator in disposable environment', async () => {
      delete process.env.NODE_ENV;
      const freshRepo = new InMemoryAuthRepository();
      const freshAuth = new AuthService(freshRepo);

      const ciUser = 'ci_operator';
      const ciPass = `CiSecret_${crypto.randomBytes(16).toString('hex')}!`;
      process.env.INITIAL_OPERATOR_USERNAME = ciUser;
      process.env.INITIAL_OPERATOR_PASSWORD = ciPass;

      await freshAuth.ensureInitialOperator();

      const ciSession = await freshAuth.authenticate(ciUser, ciPass);
      expect(ciSession.token).toBeDefined();
      expect(ciSession.operator.username).toBe(ciUser);
      expect(ciSession.operator.role).toBe('ADMIN');
    });

    it('guarantees repeated API startups do not modify password hashes or salts', async () => {
      delete process.env.NODE_ENV;
      const freshRepo = new InMemoryAuthRepository();
      const freshAuth = new AuthService(freshRepo);

      const user = 'idempotent_admin';
      const pass = 'IdempotentPass2026!';
      process.env.INITIAL_OPERATOR_USERNAME = user;
      process.env.INITIAL_OPERATOR_PASSWORD = pass;

      // Startup 1
      await freshAuth.ensureInitialOperator();
      const op1 = await freshRepo.getOperatorByUsername(user);
      const hash1 = op1!.password_hash;
      const salt1 = op1!.salt;

      // Startup 2
      await freshAuth.ensureInitialOperator();
      const op2 = await freshRepo.getOperatorByUsername(user);
      expect(op2!.password_hash).toBe(hash1);
      expect(op2!.salt).toBe(salt1);

      // Startup 3
      await freshAuth.ensureInitialOperator();
      const op3 = await freshRepo.getOperatorByUsername(user);
      expect(op3!.password_hash).toBe(hash1);
      expect(op3!.salt).toBe(salt1);
    });

    it('never prints plaintext passwords, password hashes, or salts in log outputs', async () => {
      delete process.env.NODE_ENV;
      const secretPlaintext = 'SuperSecretPlaintextNeverLeak123!';
      process.env.INITIAL_OPERATOR_USERNAME = 'audited_admin';
      process.env.INITIAL_OPERATOR_PASSWORD = secretPlaintext;

      const freshRepo = new InMemoryAuthRepository();
      const freshAuth = new AuthService(freshRepo);

      const logs: string[] = [];
      const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
        logs.push(args.map(String).join(' '));
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
        logs.push(args.map(String).join(' '));
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
        logs.push(args.map(String).join(' '));
      });

      try {
        // Run successful provisioning
        await freshAuth.ensureInitialOperator();

        // Run matching verification
        await freshAuth.ensureInitialOperator();

        // Run mismatched attempt
        process.env.INITIAL_OPERATOR_PASSWORD = 'DifferentSecretNeverLeak456!';
        await expect(freshAuth.ensureInitialOperator()).rejects.toThrow();

        const op = await freshRepo.getOperatorByUsername('audited_admin');
        const hash = op!.password_hash;
        const salt = op!.salt;

        for (const logLine of logs) {
          expect(logLine).not.toContain(secretPlaintext);
          expect(logLine).not.toContain('DifferentSecretNeverLeak456!');
          expect(logLine).not.toContain(hash);
          expect(logLine).not.toContain(salt);
        }
      } finally {
        logSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
      }
    });

    it('safely handles concurrent startup attempts without duplicate account creation or errors', async () => {
      delete process.env.NODE_ENV;
      const freshRepo = new InMemoryAuthRepository();
      const freshAuth = new AuthService(freshRepo);

      const user = 'concurrent_operator';
      const pass = 'ConcurrentPass2026!';
      process.env.INITIAL_OPERATOR_USERNAME = user;
      process.env.INITIAL_OPERATOR_PASSWORD = pass;

      // Run multiple concurrent startups
      await Promise.all([
        freshAuth.ensureInitialOperator(),
        freshAuth.ensureInitialOperator(),
        freshAuth.ensureInitialOperator(),
      ]);

      expect(await freshRepo.countOperators()).toBe(1);
      const op = await freshRepo.getOperatorByUsername(user);
      expect(op).toBeDefined();
      expect(op?.username).toBe(user);

      // Authenticates cleanly
      const session = await freshAuth.authenticate(user, pass);
      expect(session.operator.username).toBe(user);
    });
  });

  describe('HTTP 500 Global Error Sanitization & Diagnostics', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it('Test A: sanitizes arbitrary internal hostname from unexpected HTTP 500 responses', async () => {
      const failingRepo = new InMemoryAuthRepository();
      failingRepo.getOperatorByUsername = async () => {
        throw new Error('Internal upstream failure at private-db.internal.example:5432');
      };

      const failingAuth = new AuthService(failingRepo);
      const testApp = createApp({
        repository: repo,
        authService: failingAuth,
        requestService,
        assignmentService,
      });

      const res = await request(testApp).post('/auth/login').send({
        username: 'eoc_test_operator',
        password: 'SecureOperatorPassword123!',
      });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.message).toBe('An unexpected internal server error occurred');
      expect(JSON.stringify(res.body)).not.toContain('private-db.internal.example');
      expect(JSON.stringify(res.body)).not.toContain('5432');
      expect(res.body.error.stack).toBeUndefined();
    });

    it('Test B: sanitizes unknown exception messages that do not match sensitive regex patterns', async () => {
      const failingRepo = new InMemoryAuthRepository();
      failingRepo.getOperatorByUsername = async () => {
        throw new Error('Worker cluster queue failed during dispatch processing');
      };

      const failingAuth = new AuthService(failingRepo);
      const testApp = createApp({
        repository: repo,
        authService: failingAuth,
        requestService,
        assignmentService,
      });

      const res = await request(testApp).post('/auth/login').send({
        username: 'eoc_test_operator',
        password: 'SecureOperatorPassword123!',
      });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.message).toBe('An unexpected internal server error occurred');
      expect(JSON.stringify(res.body)).not.toContain('Worker cluster queue');
    });

    it('Test C: sanitizes sensitive diagnostic content (SQL details, credentials, connection string)', async () => {
      const failingRepo = new InMemoryAuthRepository();
      failingRepo.getOperatorByUsername = async () => {
        throw new Error(
          'FATAL: connection to postgres://app_user:secret_pass_123@10.0.0.5:5432/floodrelay failed in SELECT * FROM sensitive_table',
        );
      };

      const failingAuth = new AuthService(failingRepo);
      const testApp = createApp({
        repository: repo,
        authService: failingAuth,
        requestService,
        assignmentService,
      });

      const res = await request(testApp).post('/auth/login').send({
        username: 'eoc_test_operator',
        password: 'SecureOperatorPassword123!',
      });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.message).toBe('An unexpected internal server error occurred');
      const responseString = JSON.stringify(res.body);
      expect(responseString).not.toContain('secret_pass_123');
      expect(responseString).not.toContain('app_user');
      expect(responseString).not.toContain('10.0.0.5');
      expect(responseString).not.toContain('sensitive_table');
      expect(responseString).not.toContain('postgres://');
    });

    it('Test D: ensures global Express error handler unconditionally sanitizes unhandled route errors', async () => {
      const mockFailingRequestService = {
        submitRequest: vi.fn(),
        getRequestById: vi.fn(),
        listRequests: vi.fn().mockImplementation(() => {
          throw new Error('Uncaught pipeline error with internal path /var/run/secrets/token');
        }),
      } as unknown as RequestService;

      const testApp = createApp({
        repository: repo,
        authService,
        requestService: mockFailingRequestService,
        assignmentService,
      });

      // Login to get token for GET /requests
      const loginRes = await request(testApp).post('/auth/login').send({
        username: 'eoc_test_operator',
        password: 'SecureOperatorPassword123!',
      });
      const token = loginRes.body.data.token;

      const res = await request(testApp).get('/requests').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.message).toBe('An unexpected internal server error occurred');
      expect(JSON.stringify(res.body)).not.toContain('/var/run/secrets/token');
    });

    it('Test E: preserves original exception details in protected server-side diagnostics', async () => {
      const targetError = new Error('Diagnostic exception at internal-cluster.node:9000');
      const failingRepo = new InMemoryAuthRepository();
      failingRepo.getOperatorByUsername = async () => {
        throw targetError;
      };

      const failingAuth = new AuthService(failingRepo);
      const testApp = createApp({
        repository: repo,
        authService: failingAuth,
        requestService,
        assignmentService,
      });

      const res = await request(testApp).post('/auth/login').send({
        username: 'eoc_test_operator',
        password: 'SecureOperatorPassword123!',
      });

      expect(res.status).toBe(500);
      expect(res.body.error.message).toBe('An unexpected internal server error occurred');

      // Verify that server diagnostics logged the actual error
      expect(consoleErrorSpy).toHaveBeenCalled();
      const loggedCalls = consoleErrorSpy.mock.calls;
      const foundCall = loggedCalls.some((callArgs: unknown[]) =>
        callArgs.some(
          (arg: unknown) =>
            arg === targetError ||
            (arg instanceof Error && arg.message.includes('Diagnostic exception')) ||
            (typeof arg === 'string' && arg.includes('Diagnostic exception')),
        ),
      );
      expect(foundCall).toBe(true);
    });
  });
});
