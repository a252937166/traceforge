export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterMs: number;
  resetAt: number;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(Math.max(Math.trunc(parsed), minimum), maximum)
    : fallback;
}

/**
 * Small in-process guard for the public showcase. Nginx supplies a second
 * perimeter, but the API remains protected when it is run directly.
 */
export class MigrationRequestLimiter {
  readonly windowMs: number;
  readonly maxRequests: number;
  private readonly requests = new Map<string, number[]>();
  private decisions = 0;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.windowMs = boundedInteger(
      env.TRACEFORGE_MIGRATION_RATE_WINDOW_MS,
      60_000,
      1_000,
      3_600_000,
    );
    this.maxRequests = boundedInteger(
      env.TRACEFORGE_MIGRATION_RATE_MAX,
      10,
      1,
      1_000,
    );
  }

  take(key: string, now = Date.now()): RateLimitDecision {
    const cutoff = now - this.windowMs;
    const recent = (this.requests.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    const oldest = recent[0];
    if (recent.length >= this.maxRequests) {
      this.requests.set(key, recent);
      return {
        allowed: false,
        limit: this.maxRequests,
        remaining: 0,
        retryAfterMs: Math.max(1, (oldest ?? now) + this.windowMs - now),
        resetAt: (oldest ?? now) + this.windowMs,
      };
    }

    recent.push(now);
    this.requests.set(key, recent);
    this.decisions += 1;
    if (this.decisions % 100 === 0) this.prune(cutoff);
    return {
      allowed: true,
      limit: this.maxRequests,
      remaining: this.maxRequests - recent.length,
      retryAfterMs: 0,
      resetAt: (recent[0] ?? now) + this.windowMs,
    };
  }

  private prune(cutoff: number): void {
    for (const [key, timestamps] of this.requests) {
      const recent = timestamps.filter((timestamp) => timestamp > cutoff);
      if (recent.length === 0) this.requests.delete(key);
      else this.requests.set(key, recent);
    }
  }
}
