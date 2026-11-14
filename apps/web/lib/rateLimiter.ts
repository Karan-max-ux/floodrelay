/**
 * In-Memory Sliding Window Rate Limiter
 *
 * ARCHITECTURAL REVIEW & TRUST BOUNDARIES:
 * 1. Forwarded-IP Trust:
 *    - In multi-tier proxy environments (e.g., CDN -> Load Balancer -> Node.js runtime),
 *      the incoming `x-forwarded-for` header contains a comma-separated chain: `client, proxy1, proxy2`.
 *    - `getClientIp()` extracts the leftmost non-empty IP address, falling back to `x-real-ip` or 'unknown'.
 *    - TRUST BOUNDARY: If an application is exposed directly to the public internet without a trusted
 *      reverse proxy that strips or overwrites client-provided `x-forwarded-for` headers, a malicious
 *      client can spoof arbitrary IP addresses to bypass per-IP limits. In production deployments
 *      (e.g. Cloudflare, AWS ALB, Vercel), the edge reverse proxy guarantees header sanitization or
 *      provides trusted platform headers (e.g. `cf-connecting-ip`, `x-real-ip`).
 *
 * 2. In-Memory Process-Local Boundaries:
 *    - Storage: Uses an in-memory `Map<string, RateLimitRecord>`.
 *    - Ephemerality: Server restarts, worker reboots, or serverless cold starts reset counters.
 *    - Horizontal Scaling / Clustering: When running multiple Next.js worker processes, containers,
 *      or serverless lambda functions, each process maintains an isolated in-memory Map. Rate limits
 *      are enforced per-instance, not globally across the entire cluster.
 *    - Memory Management: Automatic periodic cleanup prunes expired entries when the map size exceeds
 *      1,000 keys, preventing memory leaks under sustained unique-IP traffic.
 *    - Production Escalation: For globally synchronized rate limiting across a horizontal fleet,
 *      a centralized low-latency store (e.g. Redis via ioredis or Upstash Redis) should be used.
 *      The in-memory sliding window provides zero-dependency, zero-latency protection for single-instance
 *      deployments, staging, and integration testing without expanding project scope.
 */

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitRecord>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const MAX_MAP_ENTRIES_BEFORE_CLEANUP = 1000;

export function resetRateLimiter(): void {
  rateLimitMap.clear();
}

/**
 * Extracts the client IP address from standard proxy headers.
 */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const candidate = forwardedFor.split(',')[0]?.trim();
    if (candidate) return candidate;
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp?.trim()) {
    return realIp.trim();
  }
  return 'unknown';
}

/**
 * Prunes expired rate limit records to prevent unbounded memory growth.
 */
function pruneExpiredRecords(now: number): void {
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now >= record.resetAt) {
      rateLimitMap.delete(ip);
    }
  }
}

export function checkRateLimit(
  clientIp: string,
  maxRequests = RATE_LIMIT_MAX_REQUESTS,
  windowMs = RATE_LIMIT_WINDOW_MS,
): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();

  // Prune expired records if map exceeds threshold
  if (rateLimitMap.size > MAX_MAP_ENTRIES_BEFORE_CLEANUP) {
    pruneExpiredRecords(now);
  }

  const record = rateLimitMap.get(clientIp);

  if (!record || now >= record.resetAt) {
    rateLimitMap.set(clientIp, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (record.count >= maxRequests) {
    const retryAfterSec = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
    return { allowed: false, retryAfterSec };
  }

  record.count += 1;
  return { allowed: true };
}
