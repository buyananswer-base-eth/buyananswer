// SPDX-License-Identifier: MIT
// The Hono middleware, driven through Hono's built-in `app.request` (no Miniflare): request-id
// assignment/echo, the 429 over-limit path with headers, per-identity keying, and — the part the
// worker integration tests can't easily reach — the FAIL-CLOSED 503 when the KV store is down/absent.

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { observability, rateLimit, requestId } from "./hono.js";
import type { KvLike } from "./kv.js";

function fakeKv(): KvLike {
  const store = new Map<string, string>();
  return {
    async get(k) {
      return store.get(k) ?? null;
    },
    async put(k, v) {
      store.set(k, v);
    },
    async delete(k) {
      store.delete(k);
    },
  };
}

const throwingKv: KvLike = {
  async get() {
    throw new Error("kv down");
  },
  async put() {
    throw new Error("kv down");
  },
  async delete() {},
};

const policy = { prefix: "t", limit: 2, windowSeconds: 60 };

/** An app with observability + a rate-limited `/x`, keyed by the `x-ip` header so tests vary identity. */
function makeApp(kv: KvLike | undefined) {
  const app = new Hono();
  app.use("*", observability("test-svc"));
  app.get(
    "/x",
    // Fixed clock so the window never rolls mid-test (the boundary is exercised in ratelimit.test.ts).
    rateLimit({
      kv: () => kv,
      policy,
      key: (c) => c.req.header("x-ip") ?? "anon",
      now: () => 1_000_000,
    }),
    (c) => c.text("ok"),
  );
  return app;
}

describe("requestId", () => {
  it("adopts a valid inbound token and mints a uuid otherwise", () => {
    expect(requestId("trace-abc_1.2")).toBe("trace-abc_1.2");
    expect(requestId("has space")).toHaveLength(36);
    expect(requestId("x".repeat(65))).toHaveLength(36);
    expect(requestId(undefined)).toHaveLength(36);
  });
});

describe("observability middleware", () => {
  it("sets an x-request-id response header and echoes a valid inbound one", async () => {
    const app = makeApp(fakeKv());
    const fresh = await app.request("/x");
    expect(fresh.headers.get("x-request-id")).toBeTruthy();

    const echoed = await app.request("/x", { headers: { "x-request-id": "abc_123" } });
    expect(echoed.headers.get("x-request-id")).toBe("abc_123");
  });
});

describe("rateLimit middleware", () => {
  it("allows up to the limit then 429s with RateLimit + Retry-After headers", async () => {
    const app = makeApp(fakeKv());
    expect((await app.request("/x")).status).toBe(200);
    expect((await app.request("/x")).status).toBe(200);

    const over = await app.request("/x");
    expect(over.status).toBe(429);
    expect(over.headers.get("retry-after")).toBeTruthy();
    expect(over.headers.get("ratelimit-limit")).toBe("2");
    expect(await over.json()).toMatchObject({ error: "rate_limited" });
  });

  it("keys per identity — a different client has its own window", async () => {
    const app = makeApp(fakeKv());
    await app.request("/x", { headers: { "x-ip": "1.1.1.1" } });
    await app.request("/x", { headers: { "x-ip": "1.1.1.1" } });
    // 1.1.1.1 is now at the limit, but 2.2.2.2 starts fresh.
    expect((await app.request("/x", { headers: { "x-ip": "2.2.2.2" } })).status).toBe(200);
    expect((await app.request("/x", { headers: { "x-ip": "1.1.1.1" } })).status).toBe(429);
  });

  it("FAILS CLOSED with 503 when the store throws (never a silent bypass)", async () => {
    const app = makeApp(throwingKv);
    const res = await app.request("/x");
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(await res.json()).toMatchObject({ error: "rate_limiter_unavailable" });
  });

  it("FAILS CLOSED with 503 when the store binding is missing", async () => {
    const app = makeApp(undefined);
    expect((await app.request("/x")).status).toBe(503);
  });
});
