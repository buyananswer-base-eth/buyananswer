// SPDX-License-Identifier: MIT
// The indexer's HTTP surface: liveness + a manual reconcile trigger. There are no public mutations —
// the only state this Worker writes is money-state in D1, and it writes that from confirmed chain
// events, never from a request body (FUNCTIONAL_SPEC §6/§8).
//
//   GET  /health     — liveness; reports the configured chain id (no chain/DB access).
//   POST /reconcile  — internal, bearer-token gated (fail-closed): run one reconcile pass now.

import {
  type RateLimitPolicy,
  clientIp,
  consoleErrorReporter,
  getLog,
  observability,
  rateLimit,
} from "@buyananswer/worker-kit";
import { Hono } from "hono";
import { ViemChainReader } from "./chain.js";
import { getDb } from "./db.js";
import { type Env, type IndexerContext, resolveConfig } from "./env.js";
import { SVC } from "./log.js";
import { reconcile } from "./reconcile.js";

/** Constant-time string compare (length-checked) for the reconcile bearer token. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** `POST /reconcile` is bearer-gated + internal; a per-IP window in FRONT blunts token brute-forcing. */
export const RECONCILE_LIMIT: RateLimitPolicy = {
  prefix: "reconcile",
  limit: 30,
  windowSeconds: 60,
};

export function createApp() {
  const app = new Hono<IndexerContext>();

  app.use("*", observability(SVC));

  app.onError((err, c) => {
    const path = new URL(c.req.url).pathname;
    consoleErrorReporter(getLog(c, SVC)).report(err, { method: c.req.method, path });
    return c.json({ error: "internal_error" }, 500);
  });

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  app.get("/health", (c) => {
    // Cheap liveness — no chain/DB round-trip. `ready` surfaces a hard misconfig (no deployment record).
    let chainId: number | null = null;
    let ready = false;
    try {
      chainId = resolveConfig(c.env).chainId;
      ready = true;
    } catch {
      /* leave null / not-ready */
    }
    return c.json({ ok: true, service: SVC, chainId, ready });
  });

  app.post(
    "/reconcile",
    rateLimit<Env>({ kv: (env) => env.RATELIMIT, policy: RECONCILE_LIMIT, key: clientIp }),
    async (c) => {
      const configured = c.env.RECONCILE_TOKEN?.trim();
      if (!configured) return c.json({ error: "not_configured" }, 503);
      const header = c.req.header("authorization") ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : "";
      if (!constantTimeEqual(token, configured)) return c.json({ error: "unauthorized" }, 401);

      const config = resolveConfig(c.env);
      const reader = new ViemChainReader(config);
      const result = await reconcile(getDb(c.env), reader, config);
      return c.json(result);
    },
  );

  return app;
}
