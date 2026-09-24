import { describe, expect, it } from "vitest";
import {
  JevSessionCapacityError,
  JevSessionStore,
  MAX_JEV_SESSION_IDLE_MS,
  MAX_JEV_SESSION_TTL_MS,
} from "./jevSessions";

describe("JevSessionStore", () => {
  it("returns an opaque 256-bit token while keeping the credential server-only", () => {
    let now = Date.parse("2026-09-24T00:00:00.000Z");
    const store = new JevSessionStore({ now: () => now });
    const created = store.create("fixture-key-not-for-network-use");

    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.token).not.toContain("fixture");
    expect(created.expiresAt.getTime() - now).toBe(MAX_JEV_SESSION_TTL_MS);

    const resolved = store.resolve(created.token);
    expect(resolved.state).toBe("active");
    if (resolved.state === "active") {
      expect(resolved.apiKey).toBe("fixture-key-not-for-network-use");
    }

    now += 1;
    expect(store.revoke(created.token)).toBe(true);
    expect(store.resolve(created.token)).toEqual({ state: "invalid" });
  });

  it("clamps an attempted long idle timeout to five minutes", () => {
    let now = Date.parse("2026-09-24T00:00:00.000Z");
    const store = new JevSessionStore({
      now: () => now,
      absoluteTtlMs: MAX_JEV_SESSION_TTL_MS * 5,
      idleTtlMs: MAX_JEV_SESSION_IDLE_MS * 5,
    });
    const created = store.create("fixture-key-not-for-network-use");

    now += MAX_JEV_SESSION_IDLE_MS;
    expect(store.resolve(created.token)).toEqual({ state: "expired" });
    expect(store.size).toBe(0);
  });

  it("never extends the absolute 15-minute cap during active use", () => {
    let now = Date.parse("2026-09-24T00:00:00.000Z");
    const store = new JevSessionStore({
      now: () => now,
      absoluteTtlMs: MAX_JEV_SESSION_TTL_MS * 5,
      idleTtlMs: MAX_JEV_SESSION_IDLE_MS,
    });
    const created = store.create("fixture-key-not-for-network-use");

    for (const minutes of [4, 8, 12]) {
      now = Date.parse("2026-09-24T00:00:00.000Z") + minutes * 60 * 1000;
      expect(store.resolve(created.token).state).toBe("active");
    }

    now = Date.parse("2026-09-24T00:00:00.000Z") + MAX_JEV_SESSION_TTL_MS;
    expect(store.resolve(created.token)).toEqual({ state: "expired" });
  });

  it("does not evict another active credential when capacity is reached", () => {
    const store = new JevSessionStore({ maxSessions: 1 });
    const first = store.create("fixture-key-one");

    expect(() => store.create("fixture-key-two")).toThrow(JevSessionCapacityError);
    expect(store.resolve(first.token).state).toBe("active");
  });
});
