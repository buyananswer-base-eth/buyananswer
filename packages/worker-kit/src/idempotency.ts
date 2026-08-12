// SPDX-License-Identifier: MIT
// KV-backed idempotency for non-idempotent mutations (ADR-0032). A client may send an `Idempotency-Key`
// on a retryable write (e.g. `POST /questions`); we record the first successful result under that key
// (scoped by the caller's identity) so a retry returns the SAME result instead of minting a second row.
//
// This is best-effort, not a distributed lock: KV has no atomic compare-and-set, so two GENUINELY
// simultaneous first-attempts with the same key can both miss the record and both run `produce`. That
// window is small and, for `POST /questions`, self-healing — a duplicate `pending_payment` draft that
// is never paid gets pruned by the frame's orphan sweep, and the chain is the real dedupe for money.
// The common case this defends — a client re-sending after a dropped response — is fully covered.

import type { KvLike } from "./kv.js";

/** A validated idempotency key: URL-safe token, 8–128 chars. Returns null for absent/invalid input. */
export function parseIdempotencyKey(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  return /^[A-Za-z0-9._-]{8,128}$/.test(key) ? key : null;
}

/** The result of an idempotent run: the value, and whether it was replayed from a prior attempt. */
export interface IdempotentResult<T> {
  readonly value: T;
  readonly replayed: boolean;
}

/**
 * Run `produce` at most once per `(scope, key)`, caching its JSON result in KV for `ttlSeconds`. A
 * later call with the same key returns the cached value with `replayed: true` and never calls `produce`.
 * `scope` binds the key to a principal (e.g. the session wallet) so keys can't collide across callers.
 */
export async function withIdempotency<T>(
  kv: KvLike,
  params: { scope: string; key: string; ttlSeconds: number },
  produce: () => Promise<T>,
): Promise<IdempotentResult<T>> {
  const storeKey = `idem:${params.scope}:${params.key}`;

  const existing = await kv.get(storeKey);
  if (existing !== null) {
    try {
      return { value: JSON.parse(existing) as T, replayed: true };
    } catch {
      // A corrupt record: fall through and re-produce (overwriting it) rather than fail the request.
    }
  }

  const value = await produce();
  await kv.put(storeKey, JSON.stringify(value), { expirationTtl: params.ttlSeconds });
  return { value, replayed: false };
}
