import { randomBytes } from "node:crypto";

export const MAX_JEV_SESSION_TTL_MS = 15 * 60 * 1000;
export const MAX_JEV_SESSION_IDLE_MS = 5 * 60 * 1000;

export type JevSessionResolution =
  | {
      state: "active";
      apiKey: string;
      expiresAt: Date;
    }
  | {
      state: "expired";
    }
  | {
      state: "invalid";
    };

export interface CreatedJevSession {
  /** Opaque, 256-bit bearer token. Never persist this in a browser. */
  token: string;
  expiresAt: Date;
}

interface StoredJevSession {
  apiKey: string;
  createdAtMs: number;
  expiresAtMs: number;
  lastUsedAtMs: number;
}

export interface JevSessionStoreOptions {
  /** Absolute lifetime; clamped to 15 minutes. */
  absoluteTtlMs?: number;
  /** Inactivity lifetime; clamped to 5 minutes. */
  idleTtlMs?: number;
  /** Avoid allowing an unbounded number of in-memory credential records. */
  maxSessions?: number;
  now?: () => number;
}

function boundedMs(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), maximum);
}

/**
 * Short-lived server-only storage for browser-provided Jev credentials.
 *
 * The API key is intentionally never returned from this class. The browser
 * sees only an opaque random token, while the key stays in this process's RAM
 * until explicit revocation, inactivity expiry, absolute expiry, or restart.
 */
export class JevSessionStore {
  private readonly sessions = new Map<string, StoredJevSession>();
  private readonly absoluteTtlMs: number;
  private readonly idleTtlMs: number;
  private readonly maxSessions: number;
  private readonly now: () => number;

  constructor(options: JevSessionStoreOptions = {}) {
    this.absoluteTtlMs = boundedMs(
      options.absoluteTtlMs,
      MAX_JEV_SESSION_TTL_MS,
      MAX_JEV_SESSION_TTL_MS,
    );
    this.idleTtlMs = boundedMs(
      options.idleTtlMs,
      MAX_JEV_SESSION_IDLE_MS,
      MAX_JEV_SESSION_IDLE_MS,
    );
    const configuredMaxSessions = Math.floor(options.maxSessions ?? 64);
    this.maxSessions = Number.isFinite(configuredMaxSessions)
      ? Math.max(1, Math.min(configuredMaxSessions, 256))
      : 64;
    this.now = options.now ?? Date.now;
  }

  create(apiKey: string): CreatedJevSession {
    this.clearExpired();
    if (this.sessions.size >= this.maxSessions) {
      throw new JevSessionCapacityError();
    }

    const createdAtMs = this.now();
    const expiresAtMs = createdAtMs + this.absoluteTtlMs;
    let token = randomBytes(32).toString("base64url");
    while (this.sessions.has(token)) {
      token = randomBytes(32).toString("base64url");
    }

    this.sessions.set(token, {
      apiKey,
      createdAtMs,
      expiresAtMs,
      lastUsedAtMs: createdAtMs,
    });

    return { token, expiresAt: new Date(expiresAtMs) };
  }

  resolve(token: string | undefined): JevSessionResolution {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      return { state: "invalid" };
    }

    const session = this.sessions.get(token);
    if (!session) {
      return { state: "invalid" };
    }

    const now = this.now();
    if (now >= session.expiresAtMs || now - session.lastUsedAtMs >= this.idleTtlMs) {
      this.sessions.delete(token);
      return { state: "expired" };
    }

    session.lastUsedAtMs = now;
    return {
      state: "active",
      apiKey: session.apiKey,
      expiresAt: new Date(session.expiresAtMs),
    };
  }

  revoke(token: string | undefined): boolean {
    if (!token) {
      return false;
    }
    return this.sessions.delete(token);
  }

  clearExpired(): void {
    const now = this.now();
    for (const [token, session] of this.sessions) {
      if (now >= session.expiresAtMs || now - session.lastUsedAtMs >= this.idleTtlMs) {
        this.sessions.delete(token);
      }
    }
  }

  /** Test and operational observability only; never expose this on an API. */
  get size(): number {
    this.clearExpired();
    return this.sessions.size;
  }
}

export class JevSessionCapacityError extends Error {
  constructor() {
    super("Too many active Jev sessions");
    this.name = "JevSessionCapacityError";
  }
}
