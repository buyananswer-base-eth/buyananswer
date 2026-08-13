// SPDX-License-Identifier: MIT
// Typed environment + shared constants for the BuyAnAnswer Worker API.
// Bindings are declared in wrangler.jsonc (DB=D1, SESSIONS=KV, AVATARS=R2). No secrets live here
// or in the committed wrangler.jsonc — account ids/tokens/bucket ids come from `.dev.vars` / CI.

import type { Address } from "@buyananswer/shared";
import type { ObservabilityVars } from "@buyananswer/worker-kit";

/** Cloudflare bindings + vars available to every request. */
export interface Env {
  /** D1 (SQLite) — the profile/question store. Client built with `drizzle(env.DB, { schema })`. */
  DB: D1Database;
  /** KV — single-use SIWE nonces and opaque sessions (ephemeral, TTL-keyed). ADR-0022. */
  SESSIONS: KVNamespace;
  /** KV — rate-limit counters (`rl:`) + idempotency records (`idem:`). Session 14 / ADR-0032. */
  RATELIMIT: KVNamespace;
  /** R2 — avatar image objects (png/jpeg/webp, ≤ 5 MB). */
  AVATARS: R2Bucket;
  /** Public base URL for avatars; empty ⇒ the Worker serves them at `/avatars/:wallet/:file`. */
  AVATAR_PUBLIC_BASE_URL?: string;
  /** Optional override for the session cookie lifetime (seconds). Defaults to {@link SESSION_TTL_SECONDS}. */
  SESSION_TTL_SECONDS?: string;
  /** Optional override for the nonce lifetime (seconds). Defaults to {@link NONCE_TTL_SECONDS}. */
  NONCE_TTL_SECONDS?: string;
  /**
   * Base mainnet RPC (secret). Used ONLY by SIWE to verify smart-contract-wallet signatures
   * (ERC-1271 / ERC-6492) — Coinbase Smart Wallet, Safe, EIP-7702 accounts. Unset ⇒ EOA sign-in
   * still works but every smart wallet is rejected (ADR-0039).
   */
  RPC_URL_BASE?: string;
  /** Base Sepolia RPC (secret). Same purpose as {@link RPC_URL_BASE}, for the testnet chain. */
  RPC_URL_BASE_SEPOLIA?: string;
  /**
   * Service binding to the indexer Worker, backing `POST /reconcile-nudge`. Absent ⇒ the nudge is a
   * no-op and the indexer's cron remains the only trigger (slower, still correct).
   */
  INDEXER?: Fetcher;
  /** Bearer for the indexer's `/reconcile` (secret). Must match the indexer's own value. */
  RECONCILE_TOKEN?: string;
}

/** RPC URL for `chainId`, used for smart-wallet signature verification. `undefined` ⇒ EOA-only. */
export function rpcUrlForChain(env: Env, chainId: number): string | undefined {
  const url = chainId === 8453 ? env.RPC_URL_BASE : env.RPC_URL_BASE_SEPOLIA;
  return url?.trim() || undefined;
}

/** Hono generics: env bindings + per-request variables (the authenticated wallet + observability). */
export interface AppContext {
  Bindings: Env;
  Variables: { wallet: Address } & ObservabilityVars;
}

/** SIWE nonce lifetime — a login must be completed within this window (seconds). */
export const NONCE_TTL_SECONDS = 600; // 10 minutes
/** Session lifetime (seconds). */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
/** Session cookie name. */
export const SESSION_COOKIE = "ba_session";
/** Chains a SIWE login may assert (Base + Base Sepolia; FUNCTIONAL_SPEC §11). */
export const ALLOWED_CHAIN_IDS: readonly number[] = [8453, 84532];
/** Chain a question is escrowed on when the client doesn't specify one (dev: Base Sepolia). */
export const DEFAULT_CHAIN_ID = 84532;

/** Parse a seconds TTL from an env var, falling back if unset/invalid (KV floor is 60s). */
export function ttlFromEnv(value: string | undefined, fallback: number): number {
  const n = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(n) && n >= 60 ? n : fallback;
}
