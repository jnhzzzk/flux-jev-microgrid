import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "./security";

describe("InMemoryRateLimiter", () => {
  it("does not allow a credential verification bucket to exceed its limit", () => {
    let now = 1_000;
    const limiter = new InMemoryRateLimiter({ now: () => now });

    expect(limiter.consume("connect:client", 2, 10_000)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(limiter.consume("connect:client", 2, 10_000)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(limiter.consume("connect:client", 2, 10_000)).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 10,
    });

    now += 10_000;
    expect(limiter.consume("connect:client", 2, 10_000)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });
});
