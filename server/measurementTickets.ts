import type { MeasurementReceipt, OperatingMeasurement } from "../shared/contracts.js";
import { validateMeasurement, type StoredMeasurement } from "./inputs.js";
import {
  SealedState,
  SealedStateConfigurationError,
  SealedStateTokenError,
  type JsonValue,
} from "./sealedState.js";

/** Measurement tickets must never outlive the staged-input contract. */
export const MAX_MEASUREMENT_TICKET_TTL_MS = 15 * 60 * 1000;
export const MEASUREMENT_TICKET_PREFIX = "mt1_";
export const MEASUREMENT_TICKET_PURPOSE = "jev-measurement-ticket";

const TICKET_VERSION = 1;

export interface MeasurementTicketStoreOptions {
  /** A deployment-stable seal lets a ticket survive a serverless instance change. */
  sealedState: SealedState;
  /** Lifetime of an issued ticket; it is always clamped to 15 minutes. */
  ttlMs?: number;
  /** Injectable clock for deterministic tests and expiry handling. */
  clock?: () => number;
  /** Backward-compatible clock alias for callers following the session-store API. */
  now?: () => number;
}

export interface IssuedMeasurementTicket {
  /** Opaque external identifier. It is the only measurement ID a browser receives. */
  measurementId: string;
  /** Ready to return from POST /api/measurements; it contains no observed values. */
  receipt: MeasurementReceipt;
  /** Server-side convenience metadata; do not persist it in a browser. */
  expiresAt: Date;
}

export type MeasurementTicketResolution =
  | {
      state: "active";
      /** The sealed measurement, with its internal ID replaced by the ticket ID. */
      measurement: StoredMeasurement;
      expiresAt: Date;
    }
  | {
      state: "expired";
    }
  | {
      state: "invalid";
    };

interface ParsedTicketPayload {
  issuedAtMs: number;
  expiresAtMs: number;
  stored: StoredMeasurement;
}

/**
 * Stateless, authenticated measurement references for horizontally scaled
 * deployments. The entire staged measurement is AES-GCM sealed rather than
 * kept in process memory, so another instance using the same seal can resolve
 * it. Nothing in this class logs a ticket or any observed value.
 */
export class MeasurementTicketStore {
  private readonly sealedState: SealedState;
  private readonly ttlMs: number;
  private readonly clock: () => number;

  constructor(options: MeasurementTicketStoreOptions) {
    this.sealedState = options.sealedState;
    this.ttlMs = boundedTtlMs(options.ttlMs);
    this.clock = options.clock ?? options.now ?? Date.now;
  }

  issue(stored: StoredMeasurement): IssuedMeasurementTicket {
    const normalized = normalizeStoredMeasurement(stored);
    const issuedAtMs = this.currentTimeMs();
    const expiresAtMs = issuedAtMs + this.ttlMs;
    if (!Number.isSafeInteger(expiresAtMs)) {
      throw new MeasurementTicketConfigurationError();
    }

    // Build this shape explicitly. In particular, do not spread arbitrary
    // caller input into the encrypted record or accidentally serialize a
    // getter/non-JSON value.
    const payload = {
      version: TICKET_VERSION,
      issuedAtMs,
      expiresAtMs,
      stored: serializeStoredMeasurement(normalized),
    } satisfies JsonValue;
    const sealed = this.sealedState.seal(MEASUREMENT_TICKET_PURPOSE, payload);
    const measurementId = `${MEASUREMENT_TICKET_PREFIX}${sealed}`;

    return {
      measurementId,
      receipt: {
        measurementId,
        siteId: normalized.siteId,
        measuredAt: normalized.measuredAt,
        receivedAt: normalized.receivedAt,
        status: "accepted",
      },
      expiresAt: new Date(expiresAtMs),
    };
  }

  resolve(measurementId: string | undefined): MeasurementTicketResolution {
    if (typeof measurementId !== "string") {
      return { state: "invalid" };
    }
    const sealed = extractSealedTicket(measurementId);
    if (!sealed) {
      return { state: "invalid" };
    }

    let value: JsonValue;
    try {
      value = this.sealedState.unseal<JsonValue>(MEASUREMENT_TICKET_PURPOSE, sealed);
    } catch (error) {
      if (error instanceof SealedStateConfigurationError) {
        throw error;
      }
      // SealedState deliberately keeps malformed, tampered, and wrong-purpose
      // tokens indistinguishable. Preserve that property at this boundary.
      if (error instanceof SealedStateTokenError) {
        return { state: "invalid" };
      }
      return { state: "invalid" };
    }

    const payload = parseTicketPayload(value);
    if (!payload) {
      return { state: "invalid" };
    }

    const now = this.currentTimeMs();
    if (now >= payload.expiresAtMs) {
      return { state: "expired" };
    }

    return {
      state: "active",
      measurement: {
        ...payload.stored,
        values: { ...payload.stored.values },
        // The internal UUID is never reintroduced to a request path. The
        // externally supplied sealed ticket remains the stable reference.
        measurementId,
      },
      expiresAt: new Date(payload.expiresAtMs),
    };
  }

  private currentTimeMs(): number {
    const now = this.clock();
    if (!Number.isSafeInteger(now)) {
      throw new MeasurementTicketConfigurationError();
    }
    return now;
  }
}

/** Safe configuration failure that never contains a token or measurement value. */
export class MeasurementTicketConfigurationError extends Error {
  constructor() {
    super("Measurement ticket configuration is invalid.");
    this.name = "MeasurementTicketConfigurationError";
  }
}

function boundedTtlMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return MAX_MEASUREMENT_TICKET_TTL_MS;
  }
  return Math.min(Math.floor(value), MAX_MEASUREMENT_TICKET_TTL_MS);
}

function extractSealedTicket(measurementId: string | undefined): string | null {
  if (
    typeof measurementId !== "string"
    || !measurementId.startsWith(MEASUREMENT_TICKET_PREFIX)
  ) {
    return null;
  }

  const sealed = measurementId.slice(MEASUREMENT_TICKET_PREFIX.length);
  return sealed || null;
}

function serializeStoredMeasurement(stored: StoredMeasurement): JsonValue {
  const values: Record<string, JsonValue> = {
    loadKW: stored.values.loadKW,
    solarKW: stored.values.solarKW,
    gridPowerKW: stored.values.gridPowerKW,
    batteryPowerKW: stored.values.batteryPowerKW,
    batterySocPercent: stored.values.batterySocPercent,
  };
  if (stored.values.demand15MinKW !== undefined) {
    values.demand15MinKW = stored.values.demand15MinKW;
  }
  if (stored.values.billingPeakToDateKW !== undefined) {
    values.billingPeakToDateKW = stored.values.billingPeakToDateKW;
  }

  return {
    measurementId: stored.measurementId,
    siteId: stored.siteId,
    measuredAt: stored.measuredAt,
    sequence: stored.sequence,
    values,
    receivedAt: stored.receivedAt,
  };
}

function parseTicketPayload(value: JsonValue): ParsedTicketPayload | null {
  if (!isRecord(value) || value.version !== TICKET_VERSION) {
    return null;
  }
  const issuedAtMs = value.issuedAtMs;
  const expiresAtMs = value.expiresAtMs;
  if (!isSafeInteger(issuedAtMs) || !isSafeInteger(expiresAtMs)) {
    return null;
  }
  // The issuer's local TTL setting may differ after a deploy, but no ticket
  // may ever grant a lifetime longer than the system-wide 15 minute ceiling.
  if (
    expiresAtMs <= issuedAtMs
    || expiresAtMs - issuedAtMs > MAX_MEASUREMENT_TICKET_TTL_MS
  ) {
    return null;
  }

  const stored = parseStoredMeasurement(value.stored);
  if (!stored) {
    return null;
  }
  return { issuedAtMs, expiresAtMs, stored };
}

function parseStoredMeasurement(value: JsonValue | undefined): StoredMeasurement | null {
  if (!isRecord(value) || !isRecord(value.values)) {
    return null;
  }

  const measurementId = value.measurementId;
  const siteId = value.siteId;
  const measuredAt = value.measuredAt;
  const sequence = value.sequence;
  const receivedAt = value.receivedAt;
  const loadKW = value.values.loadKW;
  const solarKW = value.values.solarKW;
  const gridPowerKW = value.values.gridPowerKW;
  const batteryPowerKW = value.values.batteryPowerKW;
  const batterySocPercent = value.values.batterySocPercent;
  if (
    !isNonEmptyString(measurementId)
    || !isNonEmptyString(siteId)
    || !isNonEmptyString(measuredAt)
    || !isSafeInteger(sequence)
    || !isNonEmptyString(receivedAt)
    || !isFiniteNumber(loadKW)
    || !isFiniteNumber(solarKW)
    || !isFiniteNumber(gridPowerKW)
    || !isFiniteNumber(batteryPowerKW)
    || !isFiniteNumber(batterySocPercent)
  ) {
    return null;
  }

  const demand15MinKW = optionalFiniteNumber(value.values.demand15MinKW);
  const billingPeakToDateKW = optionalFiniteNumber(value.values.billingPeakToDateKW);
  if (demand15MinKW === null || billingPeakToDateKW === null) {
    return null;
  }
  if ((demand15MinKW === undefined) !== (billingPeakToDateKW === undefined)) {
    return null;
  }

  const measurement: StoredMeasurement = {
    measurementId,
    siteId,
    measuredAt,
    sequence,
    values: {
      loadKW,
      solarKW,
      gridPowerKW,
      batteryPowerKW,
      batterySocPercent,
      ...(demand15MinKW === undefined ? {} : { demand15MinKW }),
      ...(billingPeakToDateKW === undefined ? {} : { billingPeakToDateKW }),
    } as OperatingMeasurement,
    receivedAt,
  };

  try {
    if (!isNonEmptyString(measurement.measurementId) || !isTimestamp(measurement.receivedAt)) {
      return null;
    }
    validateMeasurement(measurement);
    return measurement;
  } catch {
    return null;
  }
}

function normalizeStoredMeasurement(stored: StoredMeasurement): StoredMeasurement {
  // `issue` is normally called directly after acceptMeasurement(). Validate
  // again because this is the point at which observed values become a durable
  // encrypted browser reference.
  validateMeasurement(stored);
  if (!isNonEmptyString(stored.measurementId) || !isTimestamp(stored.receivedAt)) {
    throw new MeasurementTicketConfigurationError();
  }

  return {
    measurementId: stored.measurementId,
    siteId: stored.siteId,
    measuredAt: stored.measuredAt,
    sequence: stored.sequence,
    values: {
      loadKW: stored.values.loadKW,
      solarKW: stored.values.solarKW,
      gridPowerKW: stored.values.gridPowerKW,
      batteryPowerKW: stored.values.batteryPowerKW,
      batterySocPercent: stored.values.batterySocPercent,
      ...(stored.values.demand15MinKW === undefined
        ? {}
        : { demand15MinKW: stored.values.demand15MinKW }),
      ...(stored.values.billingPeakToDateKW === undefined
        ? {}
        : { billingPeakToDateKW: stored.values.billingPeakToDateKW }),
    },
    receivedAt: stored.receivedAt,
  };
}

function isRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeInteger(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function optionalFiniteNumber(value: JsonValue | undefined): number | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isFiniteNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}
