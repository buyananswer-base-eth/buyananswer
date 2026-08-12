// SPDX-License-Identifier: MIT
// Typed environment + resolved config for the BuyAnAnswer Farcaster frame.
// Bindings are declared in wrangler.jsonc (DB=D1). No secrets live here or in the committed
// wrangler.jsonc — account ids/tokens, the remote D1 id, and the hub auth come from `.dev.vars`/CI.

import { type Address, getEscrowDeployment, requireEscrowAddress } from "@buyananswer/shared";
import type { ObservabilityVars } from "@buyananswer/worker-kit";

/** Cloudflare bindings + vars available to the frame Worker. */
export interface Env {
  /** D1 (SQLite) — the SAME database the API + indexer use. We write ONLY the non-money-state mint. */
  DB: D1Database;
  /** KV — per-fid rate-limit counters for the frame POSTs (Session 14 / ADR-0032). */
  RATELIMIT: KVNamespace;
  /** EVM chain id to build transactions for (dev: 84532 Base Sepolia). Defaults to {@link DEFAULT_CHAIN_ID}. */
  CHAIN_ID?: string;
  /** Farcaster hub base URL for `POST /v1/validateMessage` (frame-signature validation). */
  FRAME_HUB_URL?: string;
  /** Optional bearer sent to the hub (e.g. a keyed provider). Empty for keyless public hubs. */
  FRAME_HUB_AUTH?: string;
  /** Web app origin for deep-links (`/ask/:handle`, `/questions/:id`, `/:handle`). */
  APP_ORIGIN?: string;
  /** Base URL the branded frame PNGs are served from. Defaults to {@link Env.APP_ORIGIN}. */
  FRAME_IMAGE_BASE?: string;
  /** Age (hours) after which an abandoned pending_payment draft is swept. Defaults to {@link DEFAULT_ORPHAN_TTL_HOURS}. */
  ORPHAN_TTL_HOURS?: string;
}

/** Hono generics for the frame's HTTP surface: bindings + the request-scoped observability vars. */
export interface FrameContext {
  Bindings: Env;
  Variables: ObservabilityVars;
}

/** Chain transactions are built for when the env doesn't specify one (dev: Base Sepolia). */
export const DEFAULT_CHAIN_ID = 84532;
/** Fallback web origin when APP_ORIGIN is unset (local dev). */
const DEFAULT_APP_ORIGIN = "http://localhost:5173";
/** Default age (hours) before an abandoned pending_payment draft is pruned by the sweep. */
export const DEFAULT_ORPHAN_TTL_HOURS = 24;

/** Immutable, validated runtime config derived from {@link Env} + the shared deployment record. */
export interface FrameConfig {
  readonly chainId: number;
  /** CAIP-2 chain id for the transaction frame response (e.g. `eip155:84532`). */
  readonly caip2: `eip155:${number}`;
  /** Escrow contract address (checksummed as recorded in the deployment). */
  readonly escrow: Address;
  /** USDC token address on this chain (the `approve` spender target is the escrow). */
  readonly usdc: Address;
  /** Block-explorer base URL for building tx links in the "sent" frame. */
  readonly explorer: string;
  /** Web app origin for deep-links (no trailing slash). */
  readonly appOrigin: string;
  /** Base URL branded frame images are served from (no trailing slash). */
  readonly imageBase: string;
  /** Farcaster hub base URL for signature validation, or undefined (⇒ verification fails closed). */
  readonly hubUrl: string | undefined;
  /** Optional hub auth bearer. */
  readonly hubAuth: string | undefined;
  /** Age (seconds) after which an abandoned pending_payment draft is swept. */
  readonly orphanTtlSeconds: number;
}

/** Parse a positive integer env var, falling back when unset/invalid. */
function intFromEnv(value: string | undefined, fallback: number, min = 1): number {
  const n = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(n) && n >= min ? n : fallback;
}

const stripSlash = (s: string) => s.replace(/\/+$/, "");

/**
 * Resolve the frame's runtime config from the environment. Throws if the chain has no *deployed*
 * escrow record in `@buyananswer/shared` (nothing to transact against) — a hard misconfiguration,
 * surfaced loudly (mirrors the indexer's `resolveConfig`).
 */
export function resolveConfig(env: Env): FrameConfig {
  const chainId = intFromEnv(env.CHAIN_ID, DEFAULT_CHAIN_ID);
  const deployment = getEscrowDeployment(chainId);
  if (!deployment || deployment.address === null) {
    throw new Error(`no deployed escrow for chain ${chainId} — cannot build ask transactions`);
  }
  const appOrigin = stripSlash(env.APP_ORIGIN?.trim() || DEFAULT_APP_ORIGIN);
  return {
    chainId,
    caip2: `eip155:${chainId}`,
    escrow: requireEscrowAddress(chainId),
    usdc: deployment.usdc,
    explorer: deployment.explorer,
    appOrigin,
    imageBase: stripSlash(env.FRAME_IMAGE_BASE?.trim() || appOrigin),
    hubUrl: env.FRAME_HUB_URL?.trim() ? stripSlash(env.FRAME_HUB_URL.trim()) : undefined,
    hubAuth: env.FRAME_HUB_AUTH?.trim() || undefined,
    orphanTtlSeconds: intFromEnv(env.ORPHAN_TTL_HOURS, DEFAULT_ORPHAN_TTL_HOURS) * 3600,
  };
}
