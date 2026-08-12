// SPDX-License-Identifier: MIT
// Session 14 abuse controls, end-to-end through the real Worker (workerd + Miniflare KV): the rate
// limiter returns a clean 429 past the ceiling, `Idempotency-Key` collapses a retried mint to one row,
// and /health reports readiness. Per-test storage isolation (vitest-pool-workers) resets the KV
// counters between tests, so each burst starts from zero.
//
// The limiter is a real-wall-clock fixed window, so a burst issues `2*limit + 1` requests: the window
// spans at most two adjacent minute buckets during a fast burst, and by pigeonhole one bucket then holds
// > limit requests — so at least one 429 is guaranteed regardless of where a minute boundary falls. The
// exact per-window boundary behaviour is unit-tested deterministically (injected clock) in worker-kit.

import { describe, expect, it } from "vitest";
import { LIMITS } from "../src/lib/limits.js";
import { ALICE_PK, BOB_PK, login, postJson, readBody, request } from "./helpers.js";

describe("rate limiting", () => {
  it("allows the first request, then returns a clean 429 with headers (POST /auth/nonce)", async () => {
    const { limit } = LIMITS.authNonce;

    const responses: Response[] = [];
    for (let i = 0; i < limit * 2 + 1; i++) {
      responses.push(await request("/auth/nonce", { method: "POST" }));
    }
    // A fresh window: the first request is always under the limit.
    expect(responses[0]?.status).toBe(200);

    // Over the limit → a clean, well-shaped 429.
    const over = responses.find((r) => r.status === 429);
    expect(over).toBeDefined();
    if (!over) return;
    const body = await readBody<{ error: string; retryAfterSeconds: number }>(over);
    expect(body.error).toBe("rate_limited");
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(over.headers.get("retry-after")).toBeTruthy();
    expect(over.headers.get("ratelimit-limit")).toBe(String(limit));
    expect(over.headers.get("ratelimit-remaining")).toBe("0");
  });

  it("limits authenticated mutations too (POST /questions), in front of auth", async () => {
    const alice = await login(ALICE_PK);
    await postJson("/handle/claim", { handle: "alice" }, alice.cookie);
    const bob = await login(BOB_PK);
    const ask = () =>
      postJson("/questions", { handle: "alice", amountUsdc: "1000000", body: "why?" }, bob.cookie);

    const statuses: number[] = [];
    for (let i = 0; i < LIMITS.questionCreate.limit * 2 + 1; i++) {
      statuses.push((await ask()).status);
    }
    expect(statuses[0]).toBe(201); // the first ask (fresh window) is allowed
    expect(statuses).toContain(429); // the flood is eventually limited
  });
});

describe("idempotency (POST /questions)", () => {
  async function seedAliceAndBob() {
    const alice = await login(ALICE_PK);
    await postJson("/handle/claim", { handle: "alice" }, alice.cookie);
    return login(BOB_PK);
  }

  function askWithKey(cookie: string, key: string | null) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (key) headers["idempotency-key"] = key;
    return request(
      "/questions",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ handle: "alice", amountUsdc: "1000000", body: "q?" }),
      },
      cookie,
    );
  }

  it("returns the same id (and mints one row) when a key is retried", async () => {
    const bob = await seedAliceAndBob();
    const first = await askWithKey(bob.cookie, "retry-key-abcdef");
    const second = await askWithKey(bob.cookie, "retry-key-abcdef");
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const id1 = (await readBody<{ id: string }>(first)).id;
    const id2 = (await readBody<{ id: string }>(second)).id;
    expect(id2).toBe(id1);

    // Exactly one row exists for bob's ask.
    const asked = await readBody<{ questions: { id: string }[] }>(
      await request("/questions/asked", {}, bob.cookie),
    );
    expect(asked.questions).toHaveLength(1);
  });

  it("mints distinct rows without a key (default behaviour is unchanged)", async () => {
    const bob = await seedAliceAndBob();
    const id1 = (await readBody<{ id: string }>(await askWithKey(bob.cookie, null))).id;
    const id2 = (await readBody<{ id: string }>(await askWithKey(bob.cookie, null))).id;
    expect(id2).not.toBe(id1);
  });
});

describe("observability", () => {
  it("/health reports liveness + readiness", async () => {
    const body = await readBody<{ ok: boolean; ready: boolean; service: string }>(
      await request("/health"),
    );
    expect(body).toMatchObject({ ok: true, ready: true, service: "buyananswer-api" });
  });

  it("assigns a request id and echoes a valid inbound one", async () => {
    const fresh = await request("/health");
    expect(fresh.headers.get("x-request-id")).toBeTruthy();

    const echoed = await request("/health", { headers: { "x-request-id": "trace-abc_123" } });
    expect(echoed.headers.get("x-request-id")).toBe("trace-abc_123");
  });
});
