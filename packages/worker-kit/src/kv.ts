// SPDX-License-Identifier: MIT
// The narrow key/value surface the rate limiter + idempotency store depend on. Kept structural (not
// `KVNamespace`) so this package needs no `@cloudflare/workers-types` dependency and so tests can pass
// a trivial in-memory fake. A real Cloudflare `KVNamespace` satisfies this interface as-is — the
// callers hand `env.RATELIMIT` straight in.

/** The subset of a Cloudflare KV namespace this package uses. */
export interface KvLike {
  /** Read a value (text), or `null` when the key is absent/expired. */
  get(key: string): Promise<string | null>;
  /** Write a value, optionally with a TTL (seconds). */
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  /** Delete a key. */
  delete(key: string): Promise<void>;
}

/** An injectable clock (epoch milliseconds). Defaults to `Date.now` in production; fixed in tests. */
export type Clock = () => number;
