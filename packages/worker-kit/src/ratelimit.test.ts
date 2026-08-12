// SPDX-License-Identifier: MIT
// The fixed-window limiter, driven by a fake in-memory KV + an injected clock so the window and the
// counter are fully deterministic (no wall-clock, no Miniflare).

import { describe, expect, it } from "vitest";
import type { KvLike } from "./kv.js";
import { kvRateLimiter } from "./ratelimit.js";

/** A trivial in-memory KV. No TTL expiry is modelled — window rollover uses a new bucket key instead. */
function fakeKv() {
  const store = new Map<string, string>();
  const puts: Array<{ key: string; ttl: number | undefined }> = [];
  const kv: KvLike = {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value, options) {
      store.set(key, value);
      puts.push({ key, ttl: options?.expirationTtl });
    },
    async delete(key) {
      store.delete(key);
    },
  };
  return { kv, puts };
}

const policy = { limit: 3, windowSeconds: 60, prefix: "test" };

describe("kvRateLimiter (fixed window)", () => {
  it("allows up to the limit, then denies, counting per identity", async () => {
    const { kv } = fakeKv();
    const now = 0;
    const limiter = kvRateLimiter(kv, policy, () => now);

    const r1 = await limiter.consume("alice");
    const r2 = await limiter.consume("alice");
    const r3 = await limiter.consume("alice");
    const r4 = await limiter.consume("alice");

    expect([r1, r2, r3].map((r) => r.allowed)).toEqual([true, true, true]);
    expect([r1.count, r2.count, r3.count]).toEqual([1, 2, 3]);
    expect([r1.remaining, r2.remaining, r3.remaining]).toEqual([2, 1, 0]);
    expect(r4.allowed).toBe(false);
    expect(r4.count).toBe(4);
    expect(r4.remaining).toBe(0);
  });

  it("keys are independent per identity", async () => {
    const { kv } = fakeKv();
    const limiter = kvRateLimiter(kv, policy, () => 0);

    await limiter.consume("alice");
    await limiter.consume("alice");
    const bob = await limiter.consume("bob");

    expect(bob.count).toBe(1);
    expect(bob.allowed).toBe(true);
  });

  it("resets when the window rolls over", async () => {
    const { kv } = fakeKv();
    let now = 0;
    const limiter = kvRateLimiter(kv, policy, () => now);

    await limiter.consume("alice");
    await limiter.consume("alice");
    await limiter.consume("alice");
    expect((await limiter.consume("alice")).allowed).toBe(false);

    now = 60_000; // next window bucket
    const next = await limiter.consume("alice");
    expect(next.allowed).toBe(true);
    expect(next.count).toBe(1);
  });

  it("reports seconds until the window rolls over", async () => {
    const { kv } = fakeKv();
    const at15s = kvRateLimiter(kv, policy, () => 15_000);
    expect((await at15s.consume("alice")).resetSeconds).toBe(45);

    const { kv: kv2 } = fakeKv();
    const at0s = kvRateLimiter(kv2, policy, () => 0);
    expect((await at0s.consume("alice")).resetSeconds).toBe(60);
  });

  it("writes each bucket with a full-window TTL (plus a small slack)", async () => {
    const { kv, puts } = fakeKv();
    const limiter = kvRateLimiter(kv, policy, () => 0);
    await limiter.consume("alice");
    expect(puts[0]?.ttl).toBe(65);
  });
});
