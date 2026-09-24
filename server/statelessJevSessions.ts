import { randomBytes } from "node:crypto";
import { SealedState, type JsonValue } from "./sealedState.js";

/** The absolute lifetime is deliberately never configurable above 15 minutes. */
export const MAX_STATELESS_JEV_SESSION_TTL_MS = 15 * 60 * 1000;
/** A token that is not renewed by use becomes unusable after at most five minutes. */
export const MAX_STATELESS_JEV_SESSION_IDLE_MS = 5 * 60 * 1000;

const SESSION_PURPOSE = "jev-browser-session";
const SESSION_SCHEMA_VERSION = 1;
const SESSION_ID_BYTES = 32;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_API_KEY_BYTES = 2 * 1024;
const MAX_DATE_MS = 8_640_000_000_000_000;

type SealedJevSessionPayload = {
  version: number;
  apiKey: string;
  sessionId: string;
  absoluteExpiresAtMs: number;
  idleExpiresAtMs: number;
} & { readonly [key: string]: JsonValue };

export interface StatelessJevSessionOptions {
  /** Absolute lifetime; clamped to 15 minutes. */
  absoluteTtlMs?: number;
  /** Idle lifetime; clamped to five minutes. */
  idleTtlMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

export interface IssuedStatelessJevSession {
  /** Opaque encrypted bearer token. Never persist it in a browser. */
  token: string;
  /** The non-extendable, absolute session deadline. */
  expiresAt: Date;
}

export type StatelessJevSessionResolution =
  | {
      state: "active";
      apiKey: string;
      /** Stable random identifier for rate-limit buckets; it survives token renewal. */
      sessionId: string;
      /** The non-extendable, absolute session deadline. */
      expiresAt: Date;
      /** Replaces the bearer token to carry the refreshed idle deadline. */
      renewedToken: string;
    }
  | {
      state: "expired";
    }
  | {
      state: "invalid";
    };

/**
 * Intentionally generic: credential values, encryption details, and token
 * parsing failures must never be surfaced in an error message.
 */
export class StatelessJevSessionError extends Error {
  constructor() {
    super("Unable to process Jev session.");
    this.name = "StatelessJevSessionError";
  }
}

function boundedMs(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), maximum);
}

function isTimestamp(value: unknown): value is number {
  return (
    typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_DATE_MS
  );
}

function isValidApiKey(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length <= MAX_API_KEY_BYTES
    && Buffer.byteLength(value, "utf8") <= MAX_API_KEY_BYTES
    && !/[\u0000-\u001F\u007F]/.test(value)
  );
}

function parsePayload(value: unknown): SealedJevSessionPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const payload = value as Partial<SealedJevSessionPayload>;
  if (
    payload.version !== SESSION_SCHEMA_VERSION
    || !isValidApiKey(payload.apiKey)
    || typeof payload.sessionId !== "string"
    || !SESSION_ID_PATTERN.test(payload.sessionId)
    || !isTimestamp(payload.absoluteExpiresAtMs)
    || !isTimestamp(payload.idleExpiresAtMs)
    || payload.idleExpiresAtMs > payload.absoluteExpiresAtMs
  ) {
    return null;
  }

  return {
    version: payload.version,
    apiKey: payload.apiKey,
    sessionId: payload.sessionId,
    absoluteExpiresAtMs: payload.absoluteExpiresAtMs,
    idleExpiresAtMs: payload.idleExpiresAtMs,
  };
}

/**
 * Encrypted, self-contained browser credential sessions for serverless hosts.
 *
 * Every token has the API key encrypted under `SealedState`; it is never sent
 * as plaintext to the browser. Resolving a token issues a replacement with a
 * fresh idle deadline, while preserving its 15-minute absolute deadline and
 * stable session ID. The caller must replace its in-memory token with
 * `renewedToken` after each successful API call.
 */
export class StatelessJevSessionStore {
  private readonly absoluteTtlMs: number;
  private readonly idleTtlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly sealedState: SealedState,
    options: StatelessJevSessionOptions = {},
  ) {
    this.absoluteTtlMs = boundedMs(
      options.absoluteTtlMs,
      MAX_STATELESS_JEV_SESSION_TTL_MS,
      MAX_STATELESS_JEV_SESSION_TTL_MS,
    );
    this.idleTtlMs = boundedMs(
      options.idleTtlMs,
      MAX_STATELESS_JEV_SESSION_IDLE_MS,
      MAX_STATELESS_JEV_SESSION_IDLE_MS,
    );
    this.now = options.now ?? Date.now;
  }

  issue(apiKey: string): IssuedStatelessJevSession {
    if (!isValidApiKey(apiKey)) {
      throw new StatelessJevSessionError();
    }

    const now = this.currentTime();
    const absoluteExpiresAtMs = this.addDuration(now, this.absoluteTtlMs);
    const idleExpiresAtMs = Math.min(
      absoluteExpiresAtMs,
      this.addDuration(now, this.idleTtlMs),
    );
    const payload: SealedJevSessionPayload = {
      version: SESSION_SCHEMA_VERSION,
      apiKey,
      sessionId: randomBytes(SESSION_ID_BYTES).toString("base64url"),
      absoluteExpiresAtMs,
      idleExpiresAtMs,
    };

    try {
      return {
        token: this.sealedState.seal(SESSION_PURPOSE, payload),
        expiresAt: new Date(absoluteExpiresAtMs),
      };
    } catch {
      throw new StatelessJevSessionError();
    }
  }

  resolve(token: string | undefined): StatelessJevSessionResolution {
    if (typeof token !== "string" || token.length === 0) {
      return { state: "invalid" };
    }

    let payload: SealedJevSessionPayload | null;
    try {
      payload = parsePayload(this.sealedState.unseal(SESSION_PURPOSE, token));
    } catch {
      // Authentication, format, and configuration failures remain
      // indistinguishable to a browser. Never log a bearer token or API key.
      return { state: "invalid" };
    }

    if (!payload) {
      return { state: "invalid" };
    }

    let now: number;
    try {
      now = this.currentTime();
    } catch {
      return { state: "invalid" };
    }

    if (now >= payload.absoluteExpiresAtMs || now >= payload.idleExpiresAtMs) {
      return { state: "expired" };
    }

    try {
      const refreshedPayload: SealedJevSessionPayload = {
        ...payload,
        idleExpiresAtMs: Math.min(
          payload.absoluteExpiresAtMs,
          this.addDuration(now, this.idleTtlMs),
        ),
      };
      return {
        state: "active",
        apiKey: payload.apiKey,
        sessionId: payload.sessionId,
        expiresAt: new Date(payload.absoluteExpiresAtMs),
        renewedToken: this.sealedState.seal(SESSION_PURPOSE, refreshedPayload),
      };
    } catch {
      return { state: "invalid" };
    }
  }

  /**
   * Stateless tokens cannot be globally revoked: any Vercel instance that has
   * the encryption key can still decrypt an already-issued token. Returning
   * false makes that limitation explicit and keeps DELETE idempotent. For a
   * hard revoke, rotate JEV_STATE_ENCRYPTION_KEY (which invalidates all tokens)
   * or add a durable deny-list outside this class.
   */
  revoke(_token: string | undefined): false {
    return false;
  }

  private currentTime(): number {
    const now = this.now();
    if (!isTimestamp(now)) {
      throw new StatelessJevSessionError();
    }
    return now;
  }

  private addDuration(timestamp: number, duration: number): number {
    const result = timestamp + duration;
    if (!isTimestamp(result)) {
      throw new StatelessJevSessionError();
    }
    return result;
  }
}
