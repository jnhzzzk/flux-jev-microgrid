export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface RateLimitWindow {
  count: number;
  resetAtMs: number;
}

export interface InMemoryRateLimiterOptions {
  now?: () => number;
  maxEntries?: number;
}

/**
 * Deliberately small, process-local limiting for credential verification and
 * Jev calls. It is defense in depth, not a replacement for edge/WAF limits in
 * a multi-instance deployment.
 */
export class InMemoryRateLimiter {
  private readonly windows = new Map<string, RateLimitWindow>();
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(options: InMemoryRateLimiterOptions = {}) {
    this.now = options.now ?? Date.now;
    const configuredMaxEntries = Math.floor(options.maxEntries ?? 2_048);
    this.maxEntries = Number.isFinite(configuredMaxEntries)
      ? Math.max(64, Math.min(configuredMaxEntries, 10_000))
      : 2_048;
  }

  consume(key: string, limit: number, windowMs: number): RateLimitResult {
    const normalizedLimit = Math.max(1, Math.floor(limit));
    const normalizedWindowMs = Math.max(1_000, Math.floor(windowMs));
    const now = this.now();
    let window = this.windows.get(key);

    if (!window || now >= window.resetAtMs) {
      this.prune(now);
      if (!this.windows.has(key) && this.windows.size >= this.maxEntries) {
        const oldest = this.windows.keys().next().value;
        if (oldest) {
          this.windows.delete(oldest);
        }
      }
      window = { count: 0, resetAtMs: now + normalizedWindowMs };
      this.windows.set(key, window);
    }

    if (window.count >= normalizedLimit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((window.resetAtMs - now) / 1_000)),
      };
    }

    window.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, normalizedLimit - window.count),
      retryAfterSeconds: Math.max(0, Math.ceil((window.resetAtMs - now) / 1_000)),
    };
  }

  remaining(key: string, limit: number, windowMs: number): number {
    const normalizedLimit = Math.max(1, Math.floor(limit));
    const normalizedWindowMs = Math.max(1_000, Math.floor(windowMs));
    const now = this.now();
    const window = this.windows.get(key);
    if (!window || now >= window.resetAtMs) {
      if (window) {
        this.windows.delete(key);
      }
      return normalizedLimit;
    }
    // Keep the API deliberately tied to the requested window. A caller cannot
    // accidentally read an unrelated bucket using a reused key.
    if (window.resetAtMs - now > normalizedWindowMs) {
      return normalizedLimit;
    }
    return Math.max(0, normalizedLimit - window.count);
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (now >= window.resetAtMs) {
        this.windows.delete(key);
      }
    }
  }
}
