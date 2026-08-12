// SPDX-License-Identifier: MIT
// Idempotency: key validation + at-most-once production with a replayed second attempt.

import { describe, expect, it } from "vitest";
import { parseIdempotencyKey, withIdempotency } from "./idempotency.js";
import type { KvLike } from "./kv.js";

function fakeKv(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  const kv: KvLike = {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
  return { kv, store };
}

describe("parseIdempotencyKey", () => {
  it("accepts a URL-safe token of 8–128 chars", () => {
    expect(parseIdempotencyKey("abcd1234")).toBe("abcd1234");
    expect(parseIdempotencyKey("  a_b-c.d1234  ")).toBe("a_b-c.d1234");
  });

  it("rejects too-short, over-long, wrong-charset, and absent keys", () => {
    expect(parseIdempotencyKey("short")).toBeNull();
    expect(parseIdempotencyKey("x".repeat(129))).toBeNull();
    expect(parseIdempotencyKey("has spaces!!")).toBeNull();
    expect(parseIdempotencyKey(null)).toBeNull();
    expect(parseIdempotencyKey(undefined)).toBeNull();
  });
});

describe("withIdempotency", () => {
  it("runs produce once, then replays the cached value", async () => {
    const { kv } = fakeKv();
    let calls = 0;
    const produce = async () => {
      calls += 1;
      return { id: "q1" };
    };

    const first = await withIdempotency(
      kv,
      { scope: "wallet", key: "abcd1234", ttlSeconds: 60 },
      produce,
    );
    const second = await withIdempotency(
      kv,
      { scope: "wallet", key: "abcd1234", ttlSeconds: 60 },
      produce,
    );

    expect(first).toEqual({ value: { id: "q1" }, replayed: false });
    expect(second).toEqual({ value: { id: "q1" }, replayed: true });
    expect(calls).toBe(1);
  });

  it("scopes keys to the principal — same key, different scope, runs again", async () => {
    const { kv } = fakeKv();
    let calls = 0;
    const produce = async () => {
      calls += 1;
      return { id: `q${calls}` };
    };

    await withIdempotency(kv, { scope: "alice", key: "abcd1234", ttlSeconds: 60 }, produce);
    const other = await withIdempotency(
      kv,
      { scope: "bob", key: "abcd1234", ttlSeconds: 60 },
      produce,
    );

    expect(other.replayed).toBe(false);
    expect(calls).toBe(2);
  });

  it("re-produces (rather than failing) when the stored record is corrupt", async () => {
    const { kv } = fakeKv({ "idem:wallet:abcd1234": "{not json" });
    const result = await withIdempotency(
      kv,
      { scope: "wallet", key: "abcd1234", ttlSeconds: 60 },
      async () => ({ id: "recovered" }),
    );
    expect(result).toEqual({ value: { id: "recovered" }, replayed: false });
  });
});
