import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createRuntimeSealedState,
  SealedState,
  SealedStateConfigurationError,
  SealedStateTokenError,
} from "./sealedState";

describe("SealedState", () => {
  it("round-trips a small JSON session payload as an opaque base64url token", () => {
    const state = new SealedState(randomBytes(32));
    const payload = {
      apiKey: "fixture-key-not-for-network-use",
      measurement: { loadKw: 178, pvKw: 92, soc: 0.46 },
      expiresAtMs: 1_790_000_000_000,
    } as const;

    const token = state.seal("jev-session", payload);

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain("fixture-key");
    expect(state.unseal<typeof payload>("jev-session", token)).toEqual(payload);
  });

  it("rejects a token when opened under a different purpose", () => {
    const state = new SealedState(randomBytes(32));
    const token = state.seal("jev-session", { sessionId: "session-1" });

    expect(() => state.unseal("measurement-cache", token)).toThrow(SealedStateTokenError);
  });

  it("rejects tampered ciphertext without exposing the authentication failure", () => {
    const state = new SealedState(randomBytes(32));
    const token = state.seal("jev-session", { sessionId: "session-1" });
    const tamperIndex = Math.floor(token.length / 2);
    const originalCharacter = token[tamperIndex]!;
    const replacement = originalCharacter === "A" ? "B" : "A";
    const tampered = `${token.slice(0, tamperIndex)}${replacement}${token.slice(tamperIndex + 1)}`;

    expect(() => state.unseal("jev-session", tampered)).toThrow(SealedStateTokenError);
  });
});

describe("createRuntimeSealedState", () => {
  it("requires an exact 32-byte base64url key in production", () => {
    expect(() =>
      createRuntimeSealedState({ environment: { NODE_ENV: "production" } }),
    ).toThrow(SealedStateConfigurationError);

    expect(() =>
      createRuntimeSealedState({
        environment: {
          NODE_ENV: "production",
          JEV_STATE_ENCRYPTION_KEY: "not-a-valid-32-byte-base64url-key",
        },
      }),
    ).toThrow(SealedStateConfigurationError);
  });

  it("uses the configured production key rather than an ephemeral key", () => {
    const encodedKey = randomBytes(32).toString("base64url");
    const environment = {
      NODE_ENV: "production",
      JEV_STATE_ENCRYPTION_KEY: encodedKey,
    };
    const issuer = createRuntimeSealedState({ environment });
    const verifier = createRuntimeSealedState({ environment });
    const token = issuer.seal("measurement-cache", { source: "meter", loadKw: 178 });

    expect(verifier.unseal("measurement-cache", token)).toEqual({ source: "meter", loadKw: 178 });
  });
});
