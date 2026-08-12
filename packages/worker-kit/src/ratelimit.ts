// SPDX-License-Identifier: MIT
// A fixed-window rate limiter over Cloudflare KV (ADR-0032). The window is bucketed by
// `floor(nowSec / windowSec)`, so each bucket is a distinct KV key with a TTL of one window — no
// stored reset timestamp, and old buckets expire themselves. The counter is a read-modify-write, which
// KV does NOT make atomic: under a burst, concurrent increments can under-count (a lost update), so a
// hair more than `limit` can slip through. That is acceptable for abuse control — it still stops
// sustained floods — and is the documented trade-off for using KV instead of a Durable Object.
//
// FAIL-SAFE (not fail-open): if the store THROWS (a KV outage), `consume` propagates the error; the
// Hono middleware translates that into a 503 (deny), never a silent bypass of the limit. See hono.ts.

import type { Clock, KvLike } from "./kv.js";

/** The outcome of consuming one unit of quota. */
export interface RateLimitResult {
  /** True when this request is within the limit (count ≤ limit). */
  readonly allowed: boolean;
  /** The configured ceiling for the window. */
  readonly limit: number;
  /** Requests seen in the current window so far (including this one). */
  readonly count: number;
  /** Remaining quota in the window (never negative). */
  readonly remaining: number;
  /** Seconds until the current window rolls over (for `Retry-After` / `RateLimit-Reset`). */
  readonly resetSeconds: number;
}

/** A limiter bound to a store + policy. `consume(id)` charges one unit against `id`'s window. */
export interface RateLimiter {
  consume(id: string): Promise<RateLimitResult>;
}

/** Rate-limit policy: at most `limit` requests per `windowSeconds`, keys namespaced by `prefix`. */
export interface RateLimitPolicy {
  readonly limit: number;
  readonly windowSeconds: number;
  /** Key namespace so distinct policies never collide in one KV namespace (e.g. `"auth_verify"`). */
  readonly prefix: string;
}

/** A short TTL cushion (seconds) so a bucket key survives just past its window before KV evicts it. */
const TTL_SLACK_SECONDS = 5;

/**
 * Build a KV-backed fixed-window limiter. `now` is injectable for deterministic tests (defaults to the
 * wall clock). The KV value stored per bucket is just the integer count as text.
 */
export function kvRateLimiter(
  kv: KvLike,
  policy: RateLimitPolicy,
  now: Clock = () => Date.now(),
): RateLimiter {
  const { limit, windowSeconds, prefix } = policy;
  return {
    async consume(id: string): Promise<RateLimitResult> {
      const nowSec = Math.floor(now() / 1000);
      const bucket = Math.floor(nowSec / windowSeconds);
      const key = `rl:${prefix}:${id}:${bucket}`;

      const current = Number.parseInt((await kv.get(key)) ?? "0", 10);
      const count = (Number.isFinite(current) && current > 0 ? current : 0) + 1;
      // Re-write the bucket with a fresh full-window TTL. Refreshing the TTL on every hit means a
      // continuously-attacked key stays counted for the whole window rather than expiring mid-flood.
      await kv.put(key, String(count), { expirationTtl: windowSeconds + TTL_SLACK_SECONDS });

      const resetSeconds = windowSeconds - (nowSec % windowSeconds);
      return {
        allowed: count <= limit,
        limit,
        count,
        remaining: Math.max(0, limit - count),
        resetSeconds,
      };
    },
  };
}
