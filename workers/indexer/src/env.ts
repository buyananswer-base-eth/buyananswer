// SPDX-License-Identifier: MIT
// Typed environment + resolved config for the BuyAnAnswer event indexer.
// Bindings are declared in wrangler.jsonc (DB=D1). No secrets live here or in the committed
// wrangler.jsonc — account ids/tokens, the RPC URL, and the reconcile token come from `.dev.vars`/CI.

import {
  type Address,
  BASE_CHAIN_ID,
  getEscrowDeployment,
  toLowerAddress,
} from "@buyananswer/shared";
import type { ObservabilityVars } from "@buyananswer/worker-kit";

/** Cloudflare bindings + vars available to the indexer (fetch handler + scheduled handler). */
export interface Env {
  /** D1 (SQLite) — the SAME database the API writes profiles/content to. Money-state is ours alone. */
  DB: D1Database;
  /** KV — rate-limit counters for `POST /reconcile` (Session 14 / ADR-0032). */
  RATELIMIT: KVNamespace;
  /** EVM chain id to index (dev: 84532 Base Sepolia). Defaults to {@link DEFAULT_CHAIN_ID}. */
  CHAIN_ID?: string;
  /** Reorg safety: don't finalize within this many blocks of the head. Defaults to {@link DEFAULT_CONFIRMATIONS}. */
  CONFIRMATIONS?: string;
  /** Max `eth_getLogs` block span per RPC call. Defaults to {@link DEFAULT_GETLOGS_RANGE}. */
  GETLOGS_RANGE?: string;
  /** Cap on blocks scanned per invocation (backfill catches up across ticks). Defaults to {@link DEFAULT_MAX_BLOCKS_PER_RUN}. */
  MAX_BLOCKS_PER_RUN?: string;
  /** Base Sepolia RPC URL (secret). Empty ⇒ viem's default public endpoint for the chain. */
  RPC_URL_BASE_SEPOLIA?: string;
  /** Base mainnet RPC URL (secret). Empty ⇒ viem's default public endpoint — see {@link resolveRpcUrl}. */
  RPC_URL_BASE?: string;
  /** Chain-agnostic RPC URL (secret). Used when the chain-specific var above is unset. */
  RPC_URL?: string;
  /**
   * Age (hours) after which an abandoned `pending_payment` draft is pruned by the hourly sweep
   * (ADR-0032). Generous by default so a slow payer is never pruned mid-flow.
   */
  ORPHAN_TTL_HOURS?: string;
  /** Bearer token gating `POST /reconcile` (secret). Unset ⇒ the endpoint is disabled (fail-closed). */
  RECONCILE_TOKEN?: string;
}

/** Hono generics for the indexer's HTTP surface: bindings + the request-scoped observability vars. */
export interface IndexerContext {
  Bindings: Env;
  Variables: ObservabilityVars;
}

/** Chain a question is escrowed on when the env doesn't specify one (dev: Base Sepolia). */
export const DEFAULT_CHAIN_ID = 84532;
/** Default confirmations before a block is treated as final (ADR-0024). */
export const DEFAULT_CONFIRMATIONS = 5;
/** Default `eth_getLogs` block span per request (public RPCs cap the range). */
export const DEFAULT_GETLOGS_RANGE = 2000;
/** Default cap on blocks scanned per invocation. */
export const DEFAULT_MAX_BLOCKS_PER_RUN = 100_000;

/** Immutable, validated runtime config derived from {@link Env} + the shared deployment record. */
export interface IndexerConfig {
  readonly chainId: number;
  /** Escrow contract address (lowercase — matches the D1 address convention + the seeded cursor). */
  readonly contractAddress: Address;
  /** Block the escrow was deployed in — the backfill floor if the cursor is missing. */
  readonly startBlock: number;
  readonly confirmations: number;
  readonly getLogsRange: number;
  readonly maxBlocksPerRun: number;
  /** RPC URL, or `undefined` to let viem use its default public endpoint for the chain. */
  readonly rpcUrl: string | undefined;
}

/** Parse a positive integer env var, falling back when unset/invalid. */
function intFromEnv(value: string | undefined, fallback: number, min = 0): number {
  const n = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(n) && n >= min ? n : fallback;
}

/**
 * Pick the RPC URL for `chainId`, preferring the chain-specific secret and falling back to the
 * chain-agnostic `RPC_URL`. Returns `undefined` only when nothing is configured, which lets viem
 * use its default PUBLIC endpoint for the chain.
 *
 * That fallback is fine on testnet but a production hazard: public Base endpoints are
 * load-balanced and read-after-write inconsistent (the Session-18 F1 defect, ADR-0037) and cap
 * `eth_getLogs` aggressively. Before Session 19 this only ever read `RPC_URL_BASE_SEPOLIA`, so a
 * mainnet (8453) indexer silently ran on the public endpoint no matter what was configured.
 * Production must set the chain's secret to one consistent private provider (ADR-0038).
 */
/** Default age (hours) before an abandoned pending_payment draft is pruned by the sweep. */
export const DEFAULT_ORPHAN_TTL_HOURS = 24;

/** Orphan-draft cutoff in SECONDS, from {@link Env.ORPHAN_TTL_HOURS} (ADR-0032). */
export function orphanTtlSeconds(env: Env): number {
  return intFromEnv(env.ORPHAN_TTL_HOURS, DEFAULT_ORPHAN_TTL_HOURS, 1) * 3600;
}

export function resolveRpcUrl(env: Env, chainId: number): string | undefined {
  const perChain = chainId === BASE_CHAIN_ID ? env.RPC_URL_BASE : env.RPC_URL_BASE_SEPOLIA;
  return perChain?.trim() || env.RPC_URL?.trim() || undefined;
}

/**
 * Resolve the indexer's runtime config from the environment. Throws if the chain has no deployment
 * record in `@buyananswer/shared` (nothing to index) — a hard misconfiguration, surfaced loudly.
 */
export function resolveConfig(env: Env): IndexerConfig {
  const chainId = intFromEnv(env.CHAIN_ID, DEFAULT_CHAIN_ID, 1);
  const deployment = getEscrowDeployment(chainId);
  if (!deployment || deployment.address === null || deployment.startBlock === null) {
    throw new Error(`no escrow deployment for chain ${chainId} — nothing to index`);
  }
  return {
    chainId,
    contractAddress: toLowerAddress(deployment.address),
    startBlock: deployment.startBlock,
    confirmations: intFromEnv(env.CONFIRMATIONS, DEFAULT_CONFIRMATIONS, 0),
    getLogsRange: intFromEnv(env.GETLOGS_RANGE, DEFAULT_GETLOGS_RANGE, 1),
    maxBlocksPerRun: intFromEnv(env.MAX_BLOCKS_PER_RUN, DEFAULT_MAX_BLOCKS_PER_RUN, 1),
    rpcUrl: resolveRpcUrl(env, chainId),
  };
}
