// SPDX-License-Identifier: MIT
// KV-backed SIWE nonces + sessions (ADR-0022). Both are ephemeral and TTL-keyed, so KV — not D1 —
// is their home. Sessions are opaque random tokens; the wallet is stored server-side, never in the
// cookie itself.

import type { Address } from "@buyananswer/shared";

const nonceKey = (nonce: string) => `nonce:${nonce}`;
const sessionKey = (token: string) => `session:${token}`;

/** A 256-bit random, URL-safe hex token. */
export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Store a freshly issued nonce with a short TTL. */
export async function issueNonce(
  kv: KVNamespace,
  nonce: string,
  ttlSeconds: number,
): Promise<void> {
  await kv.put(nonceKey(nonce), "1", { expirationTtl: ttlSeconds });
}

/**
 * Atomically consume a nonce: returns true only if it existed (and deletes it so it can never be
 * replayed). A missing nonce → false (expired, already used, or never issued).
 */
export async function consumeNonce(kv: KVNamespace, nonce: string): Promise<boolean> {
  const found = await kv.get(nonceKey(nonce));
  if (found === null) return false;
  await kv.delete(nonceKey(nonce));
  return true;
}

/** Open a session for `wallet`, returning the opaque token to set as a cookie. */
export async function createSession(
  kv: KVNamespace,
  wallet: Address,
  ttlSeconds: number,
): Promise<string> {
  const token = randomToken();
  await kv.put(sessionKey(token), JSON.stringify({ wallet }), { expirationTtl: ttlSeconds });
  return token;
}

/** Resolve a session token to its wallet, or null if unknown/expired/corrupt. */
export async function readSession(kv: KVNamespace, token: string): Promise<Address | null> {
  const raw = await kv.get(sessionKey(token));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { wallet?: unknown };
    return typeof parsed.wallet === "string" ? (parsed.wallet as Address) : null;
  } catch {
    return null;
  }
}

/** Delete a session (logout). */
export async function destroySession(kv: KVNamespace, token: string): Promise<void> {
  await kv.delete(sessionKey(token));
}
