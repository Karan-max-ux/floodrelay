import crypto from 'node:crypto';
import type { DbOperator, DbOperatorSession, OperatorProfile, OperatorRole } from '../db/schema.js';

export interface IAuthRepository {
  getOperatorByUsername(username: string): Promise<DbOperator | null>;
  getOperatorById(id: string): Promise<DbOperator | null>;
  insertOperator(operator: Omit<DbOperator, 'created_at' | 'updated_at'>): Promise<DbOperator>;
  updateOperatorPassword?(id: string, passwordHash: string, salt: string): Promise<boolean>;
  insertSession(token: string, operatorId: string, expiresAt: Date): Promise<DbOperatorSession>;
  getSessionWithOperator(
    token: string,
  ): Promise<{ session: DbOperatorSession; operator: OperatorProfile } | null>;
  deleteSession(token: string): Promise<boolean>;
  countOperators(): Promise<number>;
}

export interface AuthSessionResult {
  token: string;
  expiresAt: Date;
  operator: OperatorProfile;
}

export class AuthError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string, statusCode = 401) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class AuthService {
  private readonly repo: IAuthRepository;
  private readonly sessionDurationMs: number;
  // Rate limiting map: key -> { count: number; firstAttempt: number; lockedUntil?: number }
  private readonly failedAttempts = new Map<
    string,
    { count: number; firstAttempt: number; lockedUntil?: number }
  >();
  private readonly maxFailedAttempts = 5;
  private readonly lockoutWindowMs = 15 * 60 * 1000; // 15 minutes

  constructor(repo: IAuthRepository, sessionDurationMs = 8 * 60 * 60 * 1000) {
    this.repo = repo;
    this.sessionDurationMs = sessionDurationMs;
  }

  /**
   * Generates a random cryptographic salt and scrypt hash for a plaintext password.
   */
  public hashPassword(password: string): { hash: string; salt: string } {
    const salt = crypto.randomBytes(16).toString('hex');
    const hashBuffer = crypto.scryptSync(password, salt, 64);
    return {
      hash: hashBuffer.toString('hex'),
      salt,
    };
  }

  /**
   * Verifies a plaintext password against a stored salt and hash in constant time.
   */
  public verifyPassword(password: string, salt: string, storedHash: string): boolean {
    try {
      const computedBuffer = crypto.scryptSync(password, salt, 64);
      const storedBuffer = Buffer.from(storedHash, 'hex');
      if (computedBuffer.length !== storedBuffer.length) {
        return false;
      }
      return crypto.timingSafeEqual(computedBuffer, storedBuffer);
    } catch {
      return false;
    }
  }

  /**
   * Checks rate limiting for an identifier (e.g. username + client IP).
   */
  private checkRateLimit(key: string): void {
    const record = this.failedAttempts.get(key);
    if (!record) return;

    const now = Date.now();
    if (record.lockedUntil && now < record.lockedUntil) {
      const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000);
      throw new AuthError(
        `Too many failed login attempts. Account access is temporarily locked. Please wait ${remainingSeconds} seconds.`,
        'RATE_LIMITED',
        429,
      );
    }

    // Reset window if expired
    if (now - record.firstAttempt > this.lockoutWindowMs) {
      this.failedAttempts.delete(key);
    }
  }

  private recordFailedAttempt(key: string): void {
    const now = Date.now();
    const record = this.failedAttempts.get(key);

    if (!record || now - record.firstAttempt > this.lockoutWindowMs) {
      this.failedAttempts.set(key, { count: 1, firstAttempt: now });
      return;
    }

    record.count += 1;
    if (record.count >= this.maxFailedAttempts) {
      record.lockedUntil = now + this.lockoutWindowMs;
    }
  }

  private clearFailedAttempts(key: string): void {
    this.failedAttempts.delete(key);
  }

  /**
   * Creates a new operator account with hashed credentials.
   */
  public async createOperator(input: {
    username: string;
    password: string;
    name: string;
    role?: OperatorRole;
  }): Promise<OperatorProfile> {
    const trimmedUsername = input.username.trim().toLowerCase();
    if (trimmedUsername.length < 3) {
      throw new AuthError('Username must be at least 3 characters', 'VALIDATION_ERROR', 400);
    }
    if (input.password.length < 8) {
      throw new AuthError('Password must be at least 8 characters', 'VALIDATION_ERROR', 400);
    }

    const existing = await this.repo.getOperatorByUsername(trimmedUsername);
    if (existing) {
      throw new AuthError(`Operator "${trimmedUsername}" already exists`, 'OPERATOR_EXISTS', 409);
    }

    const { hash, salt } = this.hashPassword(input.password);
    const id = `op-${crypto.randomBytes(4).toString('hex')}`;

    const created = await this.repo.insertOperator({
      id,
      username: trimmedUsername,
      password_hash: hash,
      salt,
      name: input.name.trim(),
      role: input.role || 'OPERATOR',
      is_active: true,
    });

    return {
      id: created.id,
      username: created.username,
      name: created.name,
      role: created.role,
    };
  }

  /**
   * Updates an operator's password hash and salt securely.
   */
  public async updateOperatorPassword(id: string, newPassword: string): Promise<void> {
    if (!newPassword || newPassword.length < 8) {
      throw new AuthError(
        'Password must be at least 8 characters long',
        'PASSWORD_POLICY_VIOLATION',
        400,
      );
    }
    const { hash, salt } = this.hashPassword(newPassword);
    if (this.repo.updateOperatorPassword) {
      const ok = await this.repo.updateOperatorPassword(id, hash, salt);
      if (!ok) {
        throw new AuthError(`Operator with ID "${id}" not found`, 'OPERATOR_NOT_FOUND', 404);
      }
    } else {
      throw new Error('Repository does not support updateOperatorPassword');
    }
  }

  /**
   * Authenticates an operator and creates a new cryptographic session.
   */
  public async authenticate(
    username: string,
    password: string,
    clientIp = 'unknown',
  ): Promise<AuthSessionResult> {
    const trimmedUser = (username || '').trim().toLowerCase();
    const rateLimitKey = `${trimmedUser}:${clientIp}`;

    this.checkRateLimit(rateLimitKey);

    if (!trimmedUser || !password) {
      this.recordFailedAttempt(rateLimitKey);
      throw new AuthError('Username and password are required', 'INVALID_CREDENTIALS', 401);
    }

    // Security guard: Ensure default development credentials cannot be used in production
    if (process.env.NODE_ENV === 'production' && password === 'RescueOps@2026!') {
      this.recordFailedAttempt(rateLimitKey);
      throw new AuthError(
        'Default development credentials are strictly prohibited in production environments',
        'DEFAULT_CREDENTIALS_PROHIBITED',
        403,
      );
    }

    const operator = await this.repo.getOperatorByUsername(trimmedUser);

    if (!operator || !operator.is_active) {
      // Execute dummy scrypt hash to prevent user enumeration timing attacks
      crypto.scryptSync(password, 'dummysaltdummysalt', 64);
      this.recordFailedAttempt(rateLimitKey);
      throw new AuthError('Invalid operator credentials', 'INVALID_CREDENTIALS', 401);
    }

    const passwordValid = this.verifyPassword(password, operator.salt, operator.password_hash);
    if (!passwordValid) {
      this.recordFailedAttempt(rateLimitKey);
      throw new AuthError('Invalid operator credentials', 'INVALID_CREDENTIALS', 401);
    }

    // Success - clear failed attempts
    this.clearFailedAttempts(rateLimitKey);

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.sessionDurationMs);

    await this.repo.insertSession(token, operator.id, expiresAt);

    return {
      token,
      expiresAt,
      operator: {
        id: operator.id,
        username: operator.username,
        name: operator.name,
        role: operator.role,
      },
    };
  }

  /**
   * Validates a session token. Returns null if invalid or expired.
   */
  public async validateSession(token: string): Promise<OperatorProfile | null> {
    if (!token || typeof token !== 'string' || token.length < 32) {
      return null;
    }

    const sessionData = await this.repo.getSessionWithOperator(token);
    if (!sessionData) {
      return null;
    }

    return sessionData.operator;
  }

  /**
   * Invalidates / revokes a session token.
   */
  public async invalidateSession(token: string): Promise<boolean> {
    if (!token || typeof token !== 'string') {
      return false;
    }
    return this.repo.deleteSession(token);
  }

  /**
   * Ensures at least one initial operator exists in the system.
   * In development/test environments, provisions an initial operator if empty.
   */
  public async ensureInitialOperator(): Promise<void> {
    const hasExplicitConfig = Boolean(
      process.env.INITIAL_OPERATOR_USERNAME && process.env.INITIAL_OPERATOR_PASSWORD,
    );

    // If no explicit operator was configured and database already has operators, do nothing
    if (!hasExplicitConfig) {
      const count = await this.repo.countOperators();
      if (count > 0) {
        return;
      }
    }

    const isProd = process.env.NODE_ENV === 'production';
    const initialUser = process.env.INITIAL_OPERATOR_USERNAME || (isProd ? null : 'eoc_operator');
    const initialPass =
      process.env.INITIAL_OPERATOR_PASSWORD || (isProd ? null : 'RescueOps@2026!');
    const initialName = process.env.INITIAL_OPERATOR_NAME || 'Capt. R. Vance';

    if (isProd && initialPass === 'RescueOps@2026!') {
      throw new Error(
        '[Security Violation] Default development password "RescueOps@2026!" cannot be used as INITIAL_OPERATOR_PASSWORD in production environments. Set a unique, secure password.',
      );
    }

    if (!initialPass || !initialUser) {
      console.warn(
        '[Security Warning] No operators found in database. In production, define INITIAL_OPERATOR_USERNAME and INITIAL_OPERATOR_PASSWORD environment variables, or run create-operator CLI.',
      );
      return;
    }

    const existing = await this.repo.getOperatorByUsername(initialUser);
    if (!existing) {
      try {
        await this.createOperator({
          username: initialUser,
          password: initialPass,
          name: initialName,
          role: 'ADMIN',
        });
        console.log(`[Auth] Initial operator account "${initialUser}" initialized.`);
      } catch (err: unknown) {
        // If concurrent startup created the operator in the interim, verify it safely
        const concurrentExisting = await this.repo.getOperatorByUsername(initialUser);
        if (concurrentExisting) {
          const isValid = this.verifyPassword(
            initialPass,
            concurrentExisting.salt,
            concurrentExisting.password_hash,
          );
          if (isValid) {
            console.log(`[Auth] Configured initial operator account "${initialUser}" verified.`);
            return;
          }
        }
        throw err;
      }
    } else if (hasExplicitConfig) {
      // Case C & D: Verify existing operator credentials without resetting or modifying stored credentials
      const isValid = this.verifyPassword(initialPass, existing.salt, existing.password_hash);
      if (isValid) {
        // Case C: Configured credentials match stored operator. No modifications.
        console.log(`[Auth] Configured initial operator account "${initialUser}" verified.`);
      } else {
        // Case D: Configured credentials differ from stored operator. Do NOT reset password. Fail safely.
        console.error(
          `[Security Warning] Configured INITIAL_OPERATOR_PASSWORD does not match stored credentials for existing operator "${initialUser}". Automatic password reset on startup is prohibited. Credential rotation requires explicit authorization.`,
        );
        throw new Error(
          `[Security Violation] Configured initial operator "${initialUser}" already exists but configured password does not match stored credentials. Automatic password reset on startup is prohibited. Credential rotation requires explicit authorization.`,
        );
      }
    }
  }
}

/**
 * In-memory Auth Repository for standalone testing without database.
 */
export class InMemoryAuthRepository implements IAuthRepository {
  public operators = new Map<string, DbOperator>();
  public sessions = new Map<string, DbOperatorSession>();

  async getOperatorByUsername(username: string): Promise<DbOperator | null> {
    const key = username.trim().toLowerCase();
    for (const op of this.operators.values()) {
      if (op.username.toLowerCase() === key) return op;
    }
    return null;
  }

  async getOperatorById(id: string): Promise<DbOperator | null> {
    return this.operators.get(id) ?? null;
  }

  async insertOperator(
    operator: Omit<DbOperator, 'created_at' | 'updated_at'>,
  ): Promise<DbOperator> {
    const key = operator.username.trim().toLowerCase();
    for (const existing of this.operators.values()) {
      if (existing.username.toLowerCase() === key) {
        const err = new Error(
          `duplicate key value violates unique constraint "operators_username_key"`,
        );
        (err as unknown as { code: string }).code = '23505';
        throw err;
      }
    }
    const full: DbOperator = {
      ...operator,
      created_at: new Date(),
      updated_at: new Date(),
    };
    this.operators.set(operator.id, full);
    return full;
  }

  async updateOperatorPassword(id: string, passwordHash: string, salt: string): Promise<boolean> {
    const op = this.operators.get(id);
    if (!op) return false;
    op.password_hash = passwordHash;
    op.salt = salt;
    op.updated_at = new Date();
    return true;
  }

  async insertSession(
    token: string,
    operatorId: string,
    expiresAt: Date,
  ): Promise<DbOperatorSession> {
    const session: DbOperatorSession = {
      token,
      operator_id: operatorId,
      expires_at: expiresAt,
      created_at: new Date(),
    };
    this.sessions.set(token, session);
    return session;
  }

  async getSessionWithOperator(
    token: string,
  ): Promise<{ session: DbOperatorSession; operator: OperatorProfile } | null> {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.expires_at.getTime() <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    const op = this.operators.get(session.operator_id);
    if (!op || !op.is_active) return null;

    return {
      session,
      operator: {
        id: op.id,
        username: op.username,
        name: op.name,
        role: op.role,
      },
    };
  }

  async deleteSession(token: string): Promise<boolean> {
    return this.sessions.delete(token);
  }

  async countOperators(): Promise<number> {
    return this.operators.size;
  }
}
