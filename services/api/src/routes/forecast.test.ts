import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { InMemoryAuthRepository, AuthService } from '../services/authService.js';
import { ForecastService } from '../services/floodForecast/forecastService.js';
import type { FloodForecastProvider } from '../services/floodForecast/types.js';
import type { FloodForecastContext } from '@floodrelay/shared';
import type { OperatorRole } from '../db/schema.js';

describe('GET /forecast/context API Security, RBAC & Parameter Validation Suite', () => {
  let app: ReturnType<typeof createApp>;
  let authService: AuthService;
  let inMemoryRepo: InMemoryAuthRepository;
  let forecastService: ForecastService;
  let operatorToken: string;
  let dispatcherToken: string;
  let adminToken: string;

  const mockContext: FloodForecastContext = {
    provider: 'Copernicus EMS GloFAS via Open-Meteo',
    source: 'ECMWF GloFAS 4.0 Gridded Hydrological Model',
    attribution: 'Copernicus EMS (CC BY 4.0)',
    license: 'CC BY 4.0',
    region: {
      name: 'Yamuna River Basin (Delhi Reach)',
      targetLat: 28.65,
      targetLng: 77.23,
      stationLat: 28.675,
      stationLng: 77.225,
      elevationMeters: 227,
    },
    issuedAt: '2026-11-08T00:00:00.000Z',
    retrievedAt: '2026-11-08T06:00:00.000Z',
    validFrom: '2026-11-08T00:00:00.000Z',
    validTo: '2026-11-14T23:59:59.000Z',
    forecastHorizonDays: 7,
    variable: {
      name: 'river_discharge',
      unit: 'm³/s',
      description: 'Simulated daily river discharge rate in cubic meters per second',
    },
    daily: [
      {
        date: '2026-11-08',
        dischargeM3S: 4.25,
        dischargeMeanM3S: 4.25,
        dischargeMaxM3S: 4.25,
        dischargeMinM3S: 4.25,
      },
    ],
    currentDischargeM3S: 4.25,
    peakForecastM3S: 4.25,
    riskCategory: 'NORMAL',
    isExperimentalIndicator: true,
    freshness: 'FRESH',
    disclaimer: 'Informational context only.',
  };

  beforeEach(async () => {
    inMemoryRepo = new InMemoryAuthRepository();
    authService = new AuthService(inMemoryRepo);

    // Provision OPERATOR role
    await authService.createOperator({
      username: 'test_operator',
      password: 'SecurePassword123!',
      name: 'Standard Operator',
      role: 'OPERATOR',
    });
    const opLogin = await authService.authenticate('test_operator', 'SecurePassword123!');
    operatorToken = opLogin.token;

    // Provision DISPATCHER role
    await authService.createOperator({
      username: 'test_dispatcher',
      password: 'SecurePassword123!',
      name: 'Lead Dispatcher',
      role: 'DISPATCHER',
    });
    const dispLogin = await authService.authenticate('test_dispatcher', 'SecurePassword123!');
    dispatcherToken = dispLogin.token;

    // Provision ADMIN role
    await authService.createOperator({
      username: 'test_admin',
      password: 'SecurePassword123!',
      name: 'Operations Admin',
      role: 'ADMIN',
    });
    const adminLogin = await authService.authenticate('test_admin', 'SecurePassword123!');
    adminToken = adminLogin.token;

    const mockProvider: FloodForecastProvider = {
      name: 'MockProvider',
      getForecast: vi.fn().mockResolvedValue(mockContext),
    };
    forecastService = new ForecastService({ provider: mockProvider });

    app = createApp({
      authService,
      forecastService,
    });
  });

  describe('Authentication & Token Security', () => {
    it('rejects unauthenticated request with HTTP 401 UNAUTHORIZED', async () => {
      const res = await request(app).get('/forecast/context');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects request with malformed or invalid Bearer token with HTTP 401', async () => {
      const res = await request(app)
        .get('/forecast/context')
        .set('Authorization', 'Bearer invalid_garbage_token_99999999999999999999999999999999');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('SESSION_EXPIRED');
    });

    it('rejects request with expired session token with HTTP 401', async () => {
      // Create session expired in past (token length >= 32)
      const expiredSession = await inMemoryRepo.insertSession(
        'expired_test_token_1234567890abcdef1234567890abcdef',
        (await inMemoryRepo.getOperatorByUsername('test_operator'))!.id,
        new Date(Date.now() - 10000),
      );

      const res = await request(app)
        .get('/forecast/context')
        .set('Authorization', `Bearer ${expiredSession.token}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('SESSION_EXPIRED');
    });
  });

  describe('RBAC Authorization', () => {
    it('allows OPERATOR role with VIEW_FORECAST permission', async () => {
      const res = await request(app)
        .get('/forecast/context')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.provider).toContain('Copernicus EMS GloFAS');
    });

    it('allows DISPATCHER role with VIEW_FORECAST permission', async () => {
      const res = await request(app)
        .get('/forecast/context')
        .set('Authorization', `Bearer ${dispatcherToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.currentDischargeM3S).toBe(4.25);
    });

    it('allows ADMIN role with VIEW_FORECAST permission', async () => {
      const res = await request(app)
        .get('/forecast/context')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.riskCategory).toBe('NORMAL');
    });

    it('rejects custom/unauthorized role without VIEW_FORECAST with HTTP 403 FORBIDDEN', async () => {
      // Insert operator with an unauthorized role (e.g. VIEWER or mock restricted role)
      const restrictedOp = await inMemoryRepo.insertOperator({
        id: 'op-restricted',
        username: 'restricted_viewer',
        password_hash: 'dummy',
        salt: 'dummy',
        name: 'Restricted Viewer',
        role: 'RESTRICTED' as unknown as OperatorRole,
        is_active: true,
      });

      const restrictedToken = 'restricted_token_1234567890abcdef1234567890abcdef';
      await inMemoryRepo.insertSession(
        restrictedToken,
        restrictedOp.id,
        new Date(Date.now() + 3600000),
      );

      const res = await request(app)
        .get('/forecast/context')
        .set('Authorization', `Bearer ${restrictedToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('Access denied');
    });
  });

  describe('Query Parameter Validation Bounds', () => {
    it('rejects latitude < -90 with HTTP 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/forecast/context?lat=-90.1&lng=77.23')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects latitude > 90 with HTTP 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/forecast/context?lat=90.01&lng=77.23')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects longitude < -180 with HTTP 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/forecast/context?lat=28.65&lng=-180.5')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects longitude > 180 with HTTP 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/forecast/context?lat=28.65&lng=180.1')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects days < 1 or days > 14 or non-integer with HTTP 400 VALIDATION_ERROR', async () => {
      const resLow = await request(app)
        .get('/forecast/context?days=0')
        .set('Authorization', `Bearer ${operatorToken}`);
      expect(resLow.status).toBe(400);
      expect(resLow.body.error.code).toBe('VALIDATION_ERROR');

      const resHigh = await request(app)
        .get('/forecast/context?days=15')
        .set('Authorization', `Bearer ${operatorToken}`);
      expect(resHigh.status).toBe(400);
      expect(resHigh.body.error.code).toBe('VALIDATION_ERROR');

      const resFloat = await request(app)
        .get('/forecast/context?days=3.5')
        .set('Authorization', `Bearer ${operatorToken}`);
      expect(resFloat.status).toBe(400);
      expect(resFloat.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('handles forceRefresh=true and passes it to forecast service', async () => {
      const spy = vi.spyOn(forecastService, 'getForecastContext');
      const res = await request(app)
        .get('/forecast/context?lat=28.65&lng=77.23&forceRefresh=true')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          forceRefresh: true,
          lat: 28.65,
          lng: 77.23,
        }),
      );
    });

    it('handles forceRefresh=false and passes false to forecast service', async () => {
      const spy = vi.spyOn(forecastService, 'getForecastContext');
      const res = await request(app)
        .get('/forecast/context?lat=28.65&lng=77.23&forceRefresh=false')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          forceRefresh: false,
          lat: 28.65,
          lng: 77.23,
        }),
      );
    });
  });

  describe('HTTP 500 Error Sanitization', () => {
    it('returns sanitized JSON error envelope without leaking internal stack traces or database info', async () => {
      vi.spyOn(forecastService, 'getForecastContext').mockRejectedValueOnce(
        new Error(
          'FATAL: Connection to PostgreSQL at postgres://superadmin:secretpass@internal-cluster:5432/core_db failed with ECONNREFUSED at InternalConnection.connect (/var/app/internal.js:42:10)',
        ),
      );

      const res = await request(app)
        .get('/forecast/context')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.message).toBe('An unexpected internal server error occurred');
      expect(res.body.error.stack).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('secretpass');
      expect(JSON.stringify(res.body)).not.toContain('internal-cluster');
      expect(JSON.stringify(res.body)).not.toContain('superadmin');
    });
  });
});
