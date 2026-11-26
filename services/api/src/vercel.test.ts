import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { getDatabaseConfig, resolvePoolMax } from './db/connection.js';
import vercelDefaultApp, { createVercelApp } from './vercel.js';
import type { PostgisRepository } from './db/repository.js';
import type { AuthService } from './services/authService.js';
import type { ServiceAreaService } from './services/serviceAreaService.js';

describe('Vercel & Neon Deployment Configuration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PG_POOL_MAX;
    delete process.env.VERCEL;
    delete process.env.REQUIRE_DB;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('Database pool sizing (resolvePoolMax & getDatabaseConfig)', () => {
    it('leaves pool max unset in non-Vercel local environments when PG_POOL_MAX is unset', () => {
      process.env.DATABASE_URL = 'postgresql://local:pass@localhost:5432/floodrelay';
      expect(resolvePoolMax()).toBeUndefined();
      const cfg = getDatabaseConfig();
      expect(cfg.connectionString).toBe('postgresql://local:pass@localhost:5432/floodrelay');
      expect(cfg.max).toBeUndefined();
    });

    it('defaults pool max to 3 on Vercel when PG_POOL_MAX is unset', () => {
      process.env.VERCEL = '1';
      process.env.DATABASE_URL =
        'postgresql://user:pass@ep-demo-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';
      expect(resolvePoolMax()).toBe(3);
      const cfg = getDatabaseConfig();
      expect(cfg.max).toBe(3);
      expect(cfg.connectionString).toBe(process.env.DATABASE_URL);
    });

    it('respects explicit PG_POOL_MAX override even on Vercel', () => {
      process.env.VERCEL = '1';
      process.env.PG_POOL_MAX = '5';
      expect(resolvePoolMax()).toBe(5);
      expect(getDatabaseConfig().max).toBe(5);
    });

    it('ignores invalid PG_POOL_MAX values and falls back cleanly', () => {
      process.env.VERCEL = '1';
      process.env.PG_POOL_MAX = 'not-a-number';
      expect(resolvePoolMax()).toBe(3);

      delete process.env.VERCEL;
      process.env.PG_POOL_MAX = '0';
      expect(resolvePoolMax()).toBeUndefined();
    });
  });

  describe('Vercel Express entrypoint (services/api/src/vercel.ts & root server.ts)', () => {
    it('exports an Express handler as default from vercel.ts and root server.ts', async () => {
      expect(typeof vercelDefaultApp).toBe('function');
      const rootEntryUrl = new URL('../../../server.ts', import.meta.url).href;
      const rootMod = (await import(/* @vite-ignore */ rootEntryUrl)) as { default?: unknown };
      expect(typeof rootMod.default).toBe('function');
      expect(rootMod.default).toBe(vercelDefaultApp);
    });

    it('runs ensureInitialOperator and attestActiveBoundaryIntegrity once across requests', async () => {
      const ensureInitialOperator = vi.fn().mockResolvedValue(undefined);
      const attestActiveBoundaryIntegrity = vi.fn().mockResolvedValue({
        regionId: 'IN-NCR',
        regionName: 'Delhi National Capital Region (NCR)',
        boundaryVersion: 'ncrpb-2026-gb-ind-adm2-v1',
        datasetSha256: 'hash',
        isValid: true,
        srid: 4326,
        pointCount: 100,
        areaSqKm: 55083,
        geometryWkbHash: 'abcdef1234567890',
        isTopologicallyEqual: true,
        isMutuallyCovered: true,
        attestedAt: new Date(),
      });

      const app = createVercelApp({
        repository: {} as PostgisRepository,
        authService: { ensureInitialOperator } as unknown as AuthService,
        serviceAreaService: { attestActiveBoundaryIntegrity } as unknown as ServiceAreaService,
      });

      const res1 = await request(app).get('/health');
      expect(res1.status).toBe(200);
      expect(res1.body.status).toBe('ok');

      const res2 = await request(app).get('/openapi.json');
      expect(res2.status).toBe(200);
      expect(res2.body.openapi).toBeDefined();

      expect(ensureInitialOperator).toHaveBeenCalledTimes(1);
      expect(attestActiveBoundaryIntegrity).toHaveBeenCalledTimes(1);
    });

    it('fails closed without exiting process when REQUIRE_DB=1 startup attestation fails, and recovers on retry', async () => {
      process.env.REQUIRE_DB = '1';

      const ensureInitialOperator = vi.fn().mockResolvedValue(undefined);
      const attestActiveBoundaryIntegrity = vi
        .fn()
        .mockRejectedValueOnce(new Error('No active service-area boundary found'))
        .mockResolvedValueOnce({
          regionId: 'IN-NCR',
          regionName: 'Delhi National Capital Region (NCR)',
          boundaryVersion: 'ncrpb-2026-gb-ind-adm2-v1',
          datasetSha256: 'hash',
          isValid: true,
          srid: 4326,
          pointCount: 100,
          areaSqKm: 55083,
          geometryWkbHash: 'abcdef1234567890',
          isTopologicallyEqual: true,
          isMutuallyCovered: true,
          attestedAt: new Date(),
        });

      const app = createVercelApp({
        repository: {} as PostgisRepository,
        authService: { ensureInitialOperator } as unknown as AuthService,
        serviceAreaService: { attestActiveBoundaryIntegrity } as unknown as ServiceAreaService,
      });

      const failedRes = await request(app).get('/health');
      expect(failedRes.status).toBe(503);
      expect(failedRes.body.error.code).toBe('SERVICE_UNAVAILABLE');

      const recoveredRes = await request(app).get('/health');
      expect(recoveredRes.status).toBe(200);
      expect(recoveredRes.body.status).toBe('ok');
      expect(attestActiveBoundaryIntegrity).toHaveBeenCalledTimes(2);
    });

    it('fails closed with 500 STARTUP_SECURITY_ERROR when ensureInitialOperator throws a security violation in production', async () => {
      process.env.NODE_ENV = 'production';

      const ensureInitialOperator = vi
        .fn()
        .mockRejectedValue(
          new Error('[Security Violation] Default development password cannot be used'),
        );
      const attestActiveBoundaryIntegrity = vi.fn();

      const app = createVercelApp({
        repository: {} as PostgisRepository,
        authService: { ensureInitialOperator } as unknown as AuthService,
        serviceAreaService: { attestActiveBoundaryIntegrity } as unknown as ServiceAreaService,
      });

      const res = await request(app).get('/health');
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('STARTUP_SECURITY_ERROR');
      expect(attestActiveBoundaryIntegrity).not.toHaveBeenCalled();
    });
  });
});
