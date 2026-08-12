// SPDX-License-Identifier: MIT
// The indexer's HTTP surface: liveness + the internal, auth-gated reconcile trigger. These tests never
// send a valid bearer, so no test invokes a real reconcile (no live RPC).

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { RECONCILE_LIMIT } from "../src/app.js";
import { createApp } from "../src/index.js";

const app = createApp();
const call = (path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`https://indexer.test${path}`, init), env);

describe("GET /health", () => {
  it("reports liveness + the configured chain id", async () => {
    const res = await call("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      service: "buyananswer-indexer",
      chainId: 84532,
      ready: true,
    });
  });
});

describe("unknown routes", () => {
  it("404s", async () => {
    const res = await call("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

describe("POST /reconcile auth gate", () => {
  it("rejects a request with no Authorization header (401)", async () => {
    const res = await call("/reconcile", { method: "POST" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects a wrong bearer token (401)", async () => {
    const res = await call("/reconcile", {
      method: "POST",
      headers: { authorization: "Bearer not-the-token" },
    });
    expect(res.status).toBe(401);
  });

  it("rate-limits per IP in front of the bearer (429 past the window)", async () => {
    // Every call sends a wrong/absent bearer, so under the limit each is 401 (it passed the limiter).
    // Burst 2*limit+1 so a minute-boundary crossing can't hide the limit (one bucket must exceed it).
    const statuses: number[] = [];
    for (let i = 0; i < RECONCILE_LIMIT.limit * 2 + 1; i++) {
      statuses.push((await call("/reconcile", { method: "POST" })).status);
    }
    expect(statuses[0]).toBe(401); // passed the limiter, failed the bearer
    expect(statuses).toContain(429); // the flood is eventually limited
  });
});
