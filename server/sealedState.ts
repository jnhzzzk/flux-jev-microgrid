import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const TOKEN_VERSION = 1;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const DEFAULT_MAX_PAYLOAD_BYTES = 4 * 1024;
const MAX_MAX_PAYLOAD_BYTES = 16 * 1024;
const MAX_JSON_DEPTH = 32;
const BASE64URL_32_BYTE_KEY = /^[A-Za-z0-9_-]{43}$/;
const BASE64URL_TOKEN = /^[A-Za-z0-9_-]+$/;

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Safe to surface as a generic server-configuration failure; it never includes key material. */
export class SealedStateConfigurationError extends Error {
  constructor() {
    super("Sealed state encryption is not configured correctly.");
    this.name = "SealedStateConfigurationError";
  }
}

/** Deliberately indistinguishable authentication, format, and purpose failures. */
export class SealedStateTokenError extends Error {
  constructor() {
    super("Invalid sealed state token.");
    this.name = "SealedStateTokenError";
  }
}

export class SealedStatePayloadError extends Error {
  constructor() {
    super("Sealed state payload must be a small JSON-safe value.");
    this.name = "SealedStatePayloadError";
  }
}

export interface SealedStateOptions {
  /** Payload byte limit after UTF-8 JSON encoding. Defaults to 4 KiB. */
  maxPayloadBytes?: number;
}

export interface RuntimeSealedStateOptions extends SealedStateOptions {
  /** Injectable for tests; defaults to process.env. */
  environment?: Readonly<Record<string, string | undefined>>;
}

function configuredMaxPayloadBytes(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_MAX_PAYLOAD_BYTES;
  }

  if (!Number.isInteger(value) || value < 1 || value > MAX_MAX_PAYLOAD_BYTES) {
    throw new SealedStateConfigurationError();
  }

  return value;
}

function assertPurpose(purpose: string): Buffer {
  if (
    typeof purpose !== "string" ||
    purpose.trim().length === 0 ||
    purpose.includes("\0") ||
    Buffer.byteLength(purpose, "utf8") > 128
  ) {
    throw new SealedStateConfigurationError();
  }

  // A stable domain separator prevents these ciphertexts being confused with
  // an AES-GCM ciphertext produced for another application concern.
  return Buffer.from(`jev-sealed-state:v${TOKEN_VERSION}:${purpose}`, "utf8");
}

function assertJsonValue(value: unknown, seen = new Set<object>(), depth = 0): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }

  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      return;
    }
    throw new SealedStatePayloadError();
  }

  if (typeof value !== "object" || depth >= MAX_JSON_DEPTH || seen.has(value)) {
    throw new SealedStatePayloadError();
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (const item of value) {
        assertJsonValue(item, seen, depth + 1);
      }
      return;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new SealedStatePayloadError();
    }

    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        throw new SealedStatePayloadError();
      }

      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new SealedStatePayloadError();
      }
      assertJsonValue(descriptor.value, seen, depth + 1);
    }
  } finally {
    seen.delete(value);
  }
}

function decodeConfiguredKey(encodedKey: string): Buffer {
  // Buffer.from() accepts non-canonical base64url input, so validate first and
  // round-trip it before using the value as cryptographic material.
  if (!BASE64URL_32_BYTE_KEY.test(encodedKey)) {
    throw new SealedStateConfigurationError();
  }

  const key = Buffer.from(encodedKey, "base64url");
  if (key.byteLength !== KEY_BYTES || key.toString("base64url") !== encodedKey) {
    throw new SealedStateConfigurationError();
  }

  return key;
}

function normalizeKey(key: Uint8Array): Buffer {
  if (!(key instanceof Uint8Array) || key.byteLength !== KEY_BYTES) {
    throw new SealedStateConfigurationError();
  }
  return Buffer.from(key);
}

function maximumEncodedTokenLength(maxPayloadBytes: number): number {
  return Math.ceil(((1 + NONCE_BYTES + maxPayloadBytes + AUTH_TAG_BYTES) * 4) / 3);
}

/**
 * Small, stateless encrypted payloads for short-lived Vercel request state.
 *
 * Tokens contain a version, random nonce, AES-256-GCM ciphertext, and auth
 * tag in one opaque base64url value. The caller-provided purpose is AES-GCM
 * associated data, so a token issued for one purpose cannot be opened for
 * another purpose even when both use the same key.
 */
export class SealedState {
  private readonly key: Buffer;
  private readonly maxPayloadBytes: number;

  constructor(key: Uint8Array, options: SealedStateOptions = {}) {
    this.key = normalizeKey(key);
    this.maxPayloadBytes = configuredMaxPayloadBytes(options.maxPayloadBytes);
  }

  seal<T extends JsonValue>(purpose: string, payload: T): string {
    const associatedData = assertPurpose(purpose);
    assertJsonValue(payload);

    const serializedPayload = JSON.stringify(payload);
    const plaintext = Buffer.from(serializedPayload, "utf8");
    if (plaintext.byteLength > this.maxPayloadBytes) {
      throw new SealedStatePayloadError();
    }

    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce, {
      authTagLength: AUTH_TAG_BYTES,
    });
    cipher.setAAD(associatedData);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const token = Buffer.concat([
      Buffer.from([TOKEN_VERSION]),
      nonce,
      ciphertext,
      cipher.getAuthTag(),
    ]);

    return token.toString("base64url");
  }

  unseal<T extends JsonValue>(purpose: string, token: string): T {
    const associatedData = assertPurpose(purpose);

    try {
      const sealed = this.decodeToken(token);
      const version = sealed.readUInt8(0);
      if (version !== TOKEN_VERSION) {
        throw new SealedStateTokenError();
      }

      const nonce = sealed.subarray(1, 1 + NONCE_BYTES);
      const tag = sealed.subarray(sealed.byteLength - AUTH_TAG_BYTES);
      const ciphertext = sealed.subarray(1 + NONCE_BYTES, sealed.byteLength - AUTH_TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", this.key, nonce, {
        authTagLength: AUTH_TAG_BYTES,
      });
      decipher.setAAD(associatedData);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      if (plaintext.byteLength > this.maxPayloadBytes) {
        throw new SealedStateTokenError();
      }

      const parsed: unknown = JSON.parse(plaintext.toString("utf8"));
      assertJsonValue(parsed);
      return parsed as T;
    } catch (error) {
      if (error instanceof SealedStateConfigurationError) {
        throw error;
      }
      // Do not make authentication failures distinguishable from malformed or
      // wrong-purpose tokens to a caller.
      throw new SealedStateTokenError();
    }
  }

  private decodeToken(token: string): Buffer {
    if (
      typeof token !== "string" ||
      !BASE64URL_TOKEN.test(token) ||
      token.length > maximumEncodedTokenLength(this.maxPayloadBytes)
    ) {
      throw new SealedStateTokenError();
    }

    const sealed = Buffer.from(token, "base64url");
    const minimumLength = 1 + NONCE_BYTES + 1 + AUTH_TAG_BYTES;
    const maximumLength = 1 + NONCE_BYTES + this.maxPayloadBytes + AUTH_TAG_BYTES;
    if (
      sealed.byteLength < minimumLength ||
      sealed.byteLength > maximumLength ||
      sealed.toString("base64url") !== token
    ) {
      throw new SealedStateTokenError();
    }

    return sealed;
  }
}

/**
 * Builds a seal for the current runtime. Production requires a configured
 * JEV_STATE_ENCRYPTION_KEY; local development gets an intentionally ephemeral
 * key when none is supplied, so it cannot accidentally behave as durable
 * serverless state.
 */
export function createRuntimeSealedState(
  options: RuntimeSealedStateOptions = {},
): SealedState {
  const environment = options.environment ?? process.env;
  const encodedKey = environment.JEV_STATE_ENCRYPTION_KEY;
  const isProduction = environment.NODE_ENV === "production" || environment.VERCEL_ENV === "production";

  if (encodedKey !== undefined && encodedKey !== "") {
    return new SealedState(decodeConfiguredKey(encodedKey), options);
  }

  if (isProduction) {
    throw new SealedStateConfigurationError();
  }

  return new SealedState(randomBytes(KEY_BYTES), options);
}
