import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { MeasurementIngestRequest } from "../shared/contracts";
import { acceptMeasurement } from "./inputs";
import {
  MAX_MEASUREMENT_TICKET_TTL_MS,
  MEASUREMENT_TICKET_PREFIX,
  MEASUREMENT_TICKET_PURPOSE,
  MeasurementTicketStore,
} from "./measurementTickets";
import { SealedState, SealedStateTokenError } from "./sealedState";

const fixture: MeasurementIngestRequest = {
  siteId: "binhai-microgrid",
  measuredAt: "2026-09-24T08:00:00.000Z",
  sequence: 18_421,
  values: {
    loadKW: 178.125,
    solarKW: 92.75,
    gridPowerKW: 85.375,
    batteryPowerKW: -0.5,
    batterySocPercent: 46,
    demand15MinKW: 228,
    billingPeakToDateKW: 238,
  },
};

function createStoredMeasurement(now: number) {
  return acceptMeasurement(fixture, new Date(now)).stored;
}

describe("MeasurementTicketStore", () => {
  it("issues an opaque receipt-facing ID and resolves it on another serverless instance", () => {
    const now = Date.parse("2026-09-24T00:00:00.000Z");
    const key = randomBytes(32);
    const issuer = new MeasurementTicketStore({
      sealedState: new SealedState(key),
      clock: () => now,
    });
    const resolver = new MeasurementTicketStore({
      sealedState: new SealedState(key),
      clock: () => now,
    });
    const stored = createStoredMeasurement(now);

    const issued = issuer.issue(stored);

    expect(issued.measurementId).toMatch(/^mt1_[A-Za-z0-9_-]+$/);
    expect(issued.measurementId).toBe(issued.receipt.measurementId);
    expect(issued.receipt).toEqual({
      measurementId: issued.measurementId,
      siteId: fixture.siteId,
      measuredAt: fixture.measuredAt,
      receivedAt: new Date(now).toISOString(),
      status: "accepted",
    });
    expect(issued.measurementId).not.toContain("178125");
    expect(issued.measurementId).not.toContain("binhai-microgrid");
    expect(issued.expiresAt.getTime() - now).toBe(MAX_MEASUREMENT_TICKET_TTL_MS);

    const resolved = resolver.resolve(issued.measurementId);
    expect(resolved.state).toBe("active");
    if (resolved.state === "active") {
      expect(resolved.measurement).toEqual({
        ...stored,
        measurementId: issued.measurementId,
      });
      expect(resolved.expiresAt).toEqual(issued.expiresAt);
    }
  });

  it("uses a purpose-bound AES-GCM payload and rejects a tampered external ID", () => {
    const now = Date.parse("2026-09-24T00:00:00.000Z");
    const sealedState = new SealedState(randomBytes(32));
    const store = new MeasurementTicketStore({ sealedState, clock: () => now });
    const issued = store.issue(createStoredMeasurement(now));
    const sealed = issued.measurementId.slice(MEASUREMENT_TICKET_PREFIX.length);

    expect(() => sealedState.unseal(MEASUREMENT_TICKET_PURPOSE, sealed)).not.toThrow();
    expect(() => sealedState.unseal("jev-session", sealed)).toThrow(SealedStateTokenError);

    const index = issued.measurementId.length - 1;
    const original = issued.measurementId[index]!;
    const replacement = original === "A" ? "B" : "A";
    const tampered = `${issued.measurementId.slice(0, index)}${replacement}`;
    expect(store.resolve(tampered)).toEqual({ state: "invalid" });
  });

  it("expires at the injected clock and never permits a TTL longer than 15 minutes", () => {
    let now = Date.parse("2026-09-24T00:00:00.000Z");
    const store = new MeasurementTicketStore({
      sealedState: new SealedState(randomBytes(32)),
      ttlMs: MAX_MEASUREMENT_TICKET_TTL_MS * 10,
      now: () => now,
    });
    const issued = store.issue(createStoredMeasurement(now));

    now += MAX_MEASUREMENT_TICKET_TTL_MS - 1;
    expect(store.resolve(issued.measurementId).state).toBe("active");
    now += 1;
    expect(store.resolve(issued.measurementId)).toEqual({ state: "expired" });
  });

  it("rejects non-ticket and invalid sealed IDs without trying to expose a measurement", () => {
    const now = Date.parse("2026-09-24T00:00:00.000Z");
    const store = new MeasurementTicketStore({
      sealedState: new SealedState(randomBytes(32)),
      clock: () => now,
    });

    expect(store.resolve(undefined)).toEqual({ state: "invalid" });
    expect(store.resolve("m-not-a-ticket")).toEqual({ state: "invalid" });
    expect(store.resolve(`${MEASUREMENT_TICKET_PREFIX}not-a-valid-sealed-ticket`)).toEqual({
      state: "invalid",
    });
  });
});
