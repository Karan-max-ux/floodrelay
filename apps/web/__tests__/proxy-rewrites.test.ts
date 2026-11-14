import { describe, it, expect, beforeEach, afterEach } from 'vitest';

interface RewriteRule {
  source: string;
  destination: string;
}

interface RewritesObject {
  beforeFiles?: RewriteRule[];
  afterFiles?: RewriteRule[];
  fallback?: RewriteRule[];
}

type RewritesResult = RewriteRule[] | RewritesObject;

interface NextConfigMock {
  rewrites?: () => Promise<RewritesResult>;
}

async function getRewrites(): Promise<RewriteRule[]> {
  const mod = (await import('../next.config.mjs')) as { default: NextConfigMock };
  if (!mod.default || typeof mod.default.rewrites !== 'function') {
    return [];
  }
  const res = await mod.default.rewrites();
  if (Array.isArray(res)) {
    return res;
  }
  return [...(res.beforeFiles || []), ...(res.afterFiles || []), ...(res.fallback || [])];
}

describe('Next.js API Reverse-Proxy Rewrites Configuration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('provides reverse-proxy rewrites for all backend API route domains', async () => {
    delete process.env.BACKEND_API_URL;
    delete process.env.NEXT_PUBLIC_API_URL;

    const rewrites = await getRewrites();

    const expectedDomains = [
      '/api',
      '/auth',
      '/requests',
      '/assignments',
      '/operations',
      '/audit',
      '/forecast',
      '/health',
      '/openapi.json',
    ];

    for (const domain of expectedDomains) {
      const match = rewrites.find((r) => r.source === domain || r.source === `${domain}/:path*`);
      expect(match, `Expected rewrite for domain: ${domain}`).toBeDefined();
    }
  });

  it('defaults backendUrl fallback to port 3001 (Express backend) and never 3000 (Next.js itself)', async () => {
    delete process.env.BACKEND_API_URL;
    delete process.env.NEXT_PUBLIC_API_URL;

    const rewrites = await getRewrites();

    for (const rewrite of rewrites) {
      // Must not proxy to port 3000 (which would cause recursive loops/self-referential 404s)
      expect(rewrite.destination).not.toContain(':3000');
      expect(rewrite.destination).toContain(':3001');
    }
  });

  it('honors BACKEND_API_URL environment variable when specified', async () => {
    process.env.BACKEND_API_URL = 'http://api-service.production.internal:8080';

    const rewrites = await getRewrites();

    const operationsRewrite = rewrites.find((r) => r.source === '/operations/:path*');
    expect(operationsRewrite).toBeDefined();
    expect(operationsRewrite?.destination).toBe(
      'http://api-service.production.internal:8080/operations/:path*',
    );
  });

  it('honors NEXT_PUBLIC_API_URL when BACKEND_API_URL is unset', async () => {
    delete process.env.BACKEND_API_URL;
    process.env.NEXT_PUBLIC_API_URL = 'http://public-gateway.domain.org';

    const rewrites = await getRewrites();

    const auditRewrite = rewrites.find((r) => r.source === '/audit/:path*');
    expect(auditRewrite).toBeDefined();
    expect(auditRewrite?.destination).toBe('http://public-gateway.domain.org/audit/:path*');
  });

  it('includes exact and wildcard routes for /operations to proxy telemetry events', async () => {
    delete process.env.BACKEND_API_URL;
    delete process.env.NEXT_PUBLIC_API_URL;

    const rewrites = await getRewrites();

    const operationsWildcard = rewrites.find((r) => r.source === '/operations/:path*');
    const operationsRoot = rewrites.find((r) => r.source === '/operations');

    expect(operationsWildcard).toBeDefined();
    expect(operationsWildcard?.destination).toBe('http://localhost:3001/operations/:path*');
    expect(operationsRoot).toBeDefined();
    expect(operationsRoot?.destination).toBe('http://localhost:3001/operations');
  });

  it('includes exact and wildcard routes for /auth to proxy operator login and session endpoints', async () => {
    delete process.env.BACKEND_API_URL;
    delete process.env.NEXT_PUBLIC_API_URL;

    const rewrites = await getRewrites();

    const authWildcard = rewrites.find((r) => r.source === '/auth/:path*');
    const authRoot = rewrites.find((r) => r.source === '/auth');

    expect(authWildcard).toBeDefined();
    expect(authWildcard?.destination).toBe('http://localhost:3001/auth/:path*');
    expect(authRoot).toBeDefined();
    expect(authRoot?.destination).toBe('http://localhost:3001/auth');
  });
});
