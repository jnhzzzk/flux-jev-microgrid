import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SealedState } from "./sealedState";
import {
  MAX_STATELESS_JEV_SESSION_IDLE_MS,
  MAX_STATELESS_JEV_SESSION_TTL_MS,
  StatelessJevSessionError,
  StatelessJevSessionStore,
} from "./statelessJevSessions";

const START = Date.parse("2026-09-24T00:00:00.000Z");
const FIXTURE_KEY = "fixture-key-not-for-network-use";

function createStore(
  now: () => number,
  options: ConstructorParameters<typeof StatelessJevSessionStore>[1] = {},
): StatelessJevSessionStore {
  return new StatelessJevSessionStore(new SealedState(randomBytes(32)), { ...options, now });
}

describe("StatelessJevSessionStore", () => {
  it("seals the API key and carries a random session ID across Vercel instances", () => {
    let now = START;
    const encryptionKey = randomBytes(32);
    const issuer = new StatelessJevSessionStore(new SealedState(encryptionKey), { now: () => now });
    const resolver = new StatelessJevSessionStore(new SealedState(encryptionKey), { now: () => now });

    const issued = issuer.issue(FIXTURE_KEY);

    expect(issued.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(issued.token).not.toContain(FIXTURE_KEY);
    expect(issued.expiresAt.getTime()).toBe(START + MAX_STATELESS_JEV_SESSION_TTL_MS);

    const resolved = resolver.resolve(issued.token);
    expect(resolved.state).toBe("active");
    if (resolved.state === "active") {
      expect(resolved.apiKey).toBe(FIXTURE_KEY);
      expect(resolved.sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(resolved.expiresAt).toEqual(issued.expiresAt);
      expect(resolved.renewedToken).not.toContain(FIXTURE_KEY);
    }
  });

  it("renews only the rolling idle deadline and keeps the random session ID stable", () => {
    let now = START;
    const store = createStore(() => now);
    const issued = store.issue(FIXTURE_KEY);

    now += 4 * 60 * 1000;
    const first = store.resolve(issued.token);
    expect(first.state).toBe("active");
    if (first.state !== "active") {
      return;
    }

    now += 4 * 60 * 1000;
    const second = store.resolve(first.renewedToken);
    expect(second.state).toBe("active");
    if (second.state !== "active") {
      return;
    }
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.expiresAt).toEqual(issued.expiresAt);

    now = START + MAX_STATELESS_JEV_SESSION_TTL_MS;
    expect(store.resolve(second.renewedToken)).toEqual({ state: "expired" });
  });

  it("expires a token at the exact idle boundary when it was not renewed", () => {
    let now = START;
    const store = createStore(() => now, { idleTtlMs: MAX_STATELESS_JEV_SESSION_IDLE_MS * 5 });
    const issued = store.issue(FIXTURE_KEY);

    now += MAX_STATELESS_JEV_SESSION_IDLE_MS;
    expect(store.resolve(issued.token)).toEqual({ state: "expired" });
  });

  it("caps attempted long configured lifetimes at 15 minutes and five idle minutes", () => {
    let now = START;
    const store = createStore(() => now, {
      absoluteTtlMs: MAX_STATELESS_JEV_SESSION_TTL_MS * 5,
      idleTtlMs: MAX_STATELESS_JEV_SESSION_IDLE_MS * 5,
    });
    const issued = store.issue(FIXTURE_KEY);

    expect(issued.expiresAt.getTime()).toBe(START + MAX_STATELESS_JEV_SESSION_TTL_MS);
    now += MAX_STATELESS_JEV_SESSION_IDLE_MS;
    expect(store.resolve(issued.token)).toEqual({ state: "expired" });
  });

  it("treats malformed and tampered tokens as invalid without exposing crypto details", () => {
    let now = START;
    const store = createStore(() => now);
    const issued = store.issue(FIXTURE_KEY);
    const index = Math.floor(issued.token.length / 2);
    const original = issued.token[index]!;
    const replacement = original === "A" ? "B" : "A";
    const tampered = `${issued.token.slice(0, index)}${replacement}${issued.token.slice(index + 1)}`;

    expect(store.resolve(undefined)).toEqual({ state: "invalid" });
    expect(store.resolve("not-a-sealed-token")).toEqual({ state: "invalid" });
    expect(store.resolve(tampered)).toEqual({ state: "invalid" });
  });

  it("documents that a stateless revoke cannot invalidate a previously-issued token globally", () => {
    let now = START;
    const store = createStore(() => now);
    const issued = store.issue(FIXTURE_KEY);

    expect(store.revoke(issued.token)).toBe(false);
    expect(store.resolve(issued.token).state).toBe("active");
  });

  it("uses a generic error for an invalid credential without including its value", () => {
    const store = createStore(() => START);
    const unsafeValue = "\u0000not-a-valid-key";

    expect(() => store.issue(unsafeValue)).toThrow(StatelessJevSessionError);
    expect(() => store.issue(unsafeValue)).toThrow("Unable to process Jev session.");
  });
});
