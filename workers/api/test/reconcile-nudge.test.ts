// SPDX-License-Identifier: MIT
// `POST /reconcile-nudge` — the indexer-latency optimisation (ADR-0043).
//
// A settle is final on Base in ~12s, but the app only learned about it on the indexer's cron tick,
// so users watched a spinner for ~74s on average. This lets the client ask the indexer to reconcile
// immediately. It is PURE LATENCY: no client can assert a money outcome through it, and the indexer
// still derives every write from confirmed chain events (ADR-0024).
//
// The properties worth pinning are all about what it must NOT do:
//   • must require a session — it costs an indexer invocation, so it cannot be open to the world
//   • must NEVER leak the indexer's bearer token to the caller
//   • must NEVER fail the caller's request — it fires mid-payment, and an error there would look
//     like the payment broke. Missing binding, missing token, indexer down: all still 202.
//   • must not become a way to write state — it only triggers a read-and-reconcile.

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { ALICE_PK, ORIGIN, login, readBody, request } from "./helpers.js";

/** A stub indexer service binding that records what the API sent it. */
function stubIndexer(handler: (req: Request) => Response) {
  const calls: Request[] = [];
  return {
    calls,
    binding: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const req = new Request(input as RequestInfo, init);
        calls.push(req);
        return Promise.resolve(handler(req));
      },
    } as unknown as Fetcher,
  };
}

/**
 * Fetch the nudge endpoint with the REAL Miniflare bindings (D1, KV, R2) plus the overrides under
 * test. The KV binding matters: the rate limiter fails closed with a 503 when its store is missing,
 * so a hand-rolled env would exercise the limiter rather than the route.
 */
async function nudge(overrides: Record<string, unknown>, cookie?: string) {
  const app = createApp();
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return app.fetch(new Request(`${ORIGIN}/reconcile-nudge`, { method: "POST", headers }), {
    ...env,
    ...overrides,
  } as never);
}

describe("POST /reconcile-nudge", () => {
  it("requires a session — it costs an indexer invocation", async () => {
    const res = await request("/reconcile-nudge", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("forwards to the indexer with the bearer token attached SERVER-SIDE", async () => {
    const { cookie } = await login(ALICE_PK);
    const indexer = stubIndexer(() => new Response("{}", { status: 200 }));
    const res = await nudge({ INDEXER: indexer.binding, RECONCILE_TOKEN: "s3cret" }, cookie);

    expect(res.status).toBe(202);
    expect(await readBody(res)).toEqual({ nudged: true });
    expect(indexer.calls).toHaveLength(1);
    const sent = indexer.calls[0];
    if (!sent) throw new Error("expected a forwarded request");
    expect(new URL(sent.url).pathname).toBe("/reconcile");
    expect(sent.method).toBe("POST");
    expect(sent.headers.get("authorization")).toBe("Bearer s3cret");
  });

  it("NEVER returns the token to the caller", async () => {
    const { cookie } = await login(ALICE_PK);
    const indexer = stubIndexer(() => new Response("{}", { status: 200 }));
    const res = await nudge({ INDEXER: indexer.binding, RECONCILE_TOKEN: "s3cret" }, cookie);
    const text = JSON.stringify(await readBody(res));
    expect(text).not.toContain("s3cret");
    expect(res.headers.get("authorization")).toBeNull();
  });

  it("still returns 202 when the indexer THROWS — never breaks a payment in flight", async () => {
    const { cookie } = await login(ALICE_PK);
    const indexer = {
      fetch: () => Promise.reject(new Error("indexer down")),
    } as unknown as Fetcher;
    const res = await nudge({ INDEXER: indexer, RECONCILE_TOKEN: "s3cret" }, cookie);
    expect(res.status).toBe(202);
    expect(await readBody(res)).toEqual({ nudged: false, reason: "unavailable" });
  });

  it("still returns 202 when the indexer responds non-2xx", async () => {
    const { cookie } = await login(ALICE_PK);
    const indexer = stubIndexer(() => new Response("nope", { status: 503 }));
    const res = await nudge({ INDEXER: indexer.binding, RECONCILE_TOKEN: "s3cret" }, cookie);
    expect(res.status).toBe(202);
    expect(await readBody(res)).toEqual({ nudged: false });
  });

  it("degrades to a no-op when unconfigured, rather than erroring", async () => {
    const { cookie } = await login(ALICE_PK);
    // No binding and no token: the cron still reconciles, so this is slower, not broken.
    const res = await nudge({}, cookie);
    expect(res.status).toBe(202);
    expect(await readBody(res)).toEqual({ nudged: false, reason: "not_configured" });
  });

  it("does not call the indexer when the token is missing", async () => {
    const { cookie } = await login(ALICE_PK);
    const indexer = stubIndexer(() => new Response("{}", { status: 200 }));
    const res = await nudge({ INDEXER: indexer.binding }, cookie);
    expect(res.status).toBe(202);
    expect(indexer.calls).toHaveLength(0);
  });
});
