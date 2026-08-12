// SPDX-License-Identifier: MIT
// Hono glue for the shared observability + rate-limit primitives (ADR-0032, ADR-0033). All three
// Workers use Hono, so the middleware lives here rather than being re-adapted in each app:
//
//   • observability(svc)  — assigns/propagates a request id, puts a child logger on the context, sets
//                           the `x-request-id` response header, and logs one `req` line per request.
//   • rateLimit(opts)     — a fixed-window KV limiter in FRONT of a route. FAIL-CLOSED: a KV outage
//                           returns 503 (deny), never a silent bypass. Over-limit returns a clean 429.
//
// The limiter is built per-request from `c.env` (KV bindings only exist per invocation), so `opts.kv`
// extracts the namespace from the env and `opts.key` derives the identity (usually the client IP).

import type { Context, MiddlewareHandler } from "hono";
import { describeError } from "./errors.js";
import type { Clock, KvLike } from "./kv.js";
import { type Logger, createLogger } from "./logger.js";
import { type RateLimitPolicy, kvRateLimiter } from "./ratelimit.js";

/** Context variables the {@link observability} middleware sets. Workers add these to their Hono env. */
export interface ObservabilityVars {
  /** A request-scoped child logger, pre-bound with `{ reqId }`. */
  log: Logger;
  /** The request correlation id (echoed as the `x-request-id` response header). */
  reqId: string;
}

/** A request id is a short, safe token — reuse an inbound one only if it matches; else mint a uuid. */
const REQ_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** Validate/adopt an inbound `x-request-id`, or generate a fresh uuid (input-bounded). */
export function requestId(inbound: string | null | undefined): string {
  return inbound && REQ_ID_RE.test(inbound) ? inbound : crypto.randomUUID();
}

/** The request path (no query), bounded so a pathological URL can't blow up a log line. */
function safePath(url: string): string {
  try {
    return new URL(url).pathname.slice(0, 512);
  } catch {
    return url.slice(0, 512);
  }
}

/** Read the request-scoped logger set by {@link observability}, or a bare fallback if absent. */
export function getLog(c: Context, fallbackSvc = "worker"): Logger {
  return (c.get("log") as Logger | undefined) ?? createLogger(fallbackSvc);
}

/** Read the request id set by {@link observability} (empty string if the middleware didn't run). */
export function getReqId(c: Context): string {
  return (c.get("reqId") as string | undefined) ?? "";
}

/**
 * Assign a request id, attach a child logger, echo `x-request-id`, and log one `req` line per request
 * (skipping `/health` to keep liveness pings out of the log). Mount FIRST so every handler + `onError`
 * sees the correlated logger via {@link getLog}.
 */
export function observability(svc: string): MiddlewareHandler {
  return async (c, next) => {
    const reqId = requestId(c.req.header("x-request-id"));
    const log = createLogger(svc, { reqId });
    c.set("reqId", reqId);
    c.set("log", log);
    c.header("x-request-id", reqId);

    const start = Date.now();
    const path = safePath(c.req.url);
    try {
      await next();
    } finally {
      if (path !== "/health") {
        log.info("req", {
          method: c.req.method,
          path,
          status: c.res?.status ?? 0,
          ms: Date.now() - start,
        });
      }
    }
  };
}

/** The client IP as Cloudflare reports it (`CF-Connecting-IP`), with a header fallback for local dev. */
export function clientIp(c: Context): string {
  const cf = c.req.header("cf-connecting-ip");
  if (cf) return cf;
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return "unknown";
}

/** Options for {@link rateLimit}. `kv` pulls the KV namespace from the (per-request) env. */
export interface RateLimitOptions<B> {
  /** Extract the rate-limit KV namespace from the request env (returns undefined ⇒ fail-closed). */
  kv: (env: B) => KvLike | undefined;
  /** The window policy (limit, windowSeconds, prefix). */
  policy: RateLimitPolicy;
  /** Derive the identity charged against the window (usually {@link clientIp}). */
  key: (c: Context) => string;
  /** Injectable clock for deterministic tests (defaults to the wall clock). */
  now?: Clock;
}

/**
 * Fixed-window rate limit in front of a route. Emits `RateLimit-*` headers; returns 429 (+ `Retry-After`)
 * over the limit and 503 (+ `Retry-After`) if the KV store is unavailable — FAIL-CLOSED, so a store
 * outage denies rather than silently disabling the limit on a money endpoint (ADR-0032).
 */
export function rateLimit<B = unknown>(opts: RateLimitOptions<B>): MiddlewareHandler {
  return async (c, next) => {
    const log = getLog(c);
    const store = opts.kv(c.env as B);
    if (!store) {
      log.error("ratelimit_no_store", { prefix: opts.policy.prefix });
      c.header("retry-after", "5");
      return c.json({ error: "rate_limiter_unavailable" }, 503);
    }

    let result: Awaited<ReturnType<ReturnType<typeof kvRateLimiter>["consume"]>>;
    try {
      result = await kvRateLimiter(store, opts.policy, opts.now).consume(opts.key(c));
    } catch (err) {
      log.error("ratelimit_store_error", { prefix: opts.policy.prefix, ...describeError(err) });
      c.header("retry-after", "5");
      return c.json({ error: "rate_limiter_unavailable" }, 503);
    }

    c.header("RateLimit-Limit", String(result.limit));
    c.header("RateLimit-Remaining", String(result.remaining));
    c.header("RateLimit-Reset", String(result.resetSeconds));

    if (!result.allowed) {
      log.warn("rate_limited", {
        prefix: opts.policy.prefix,
        count: result.count,
        limit: result.limit,
      });
      c.header("retry-after", String(result.resetSeconds));
      return c.json({ error: "rate_limited", retryAfterSeconds: result.resetSeconds }, 429);
    }

    await next();
  };
}
