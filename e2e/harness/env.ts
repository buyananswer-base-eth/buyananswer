// SPDX-License-Identifier: MIT
// The harness's resolved environment. Also loads `e2e/.env` into `process.env` (Playwright does not do
// this, and the README has always told the owner to put the on-chain secrets there) — existing shell
// variables always win, so CI, which passes real secrets as env vars, is unaffected.
//
// Every address comes from env, defaulting to the `@buyananswer/shared` Base Sepolia deployment record:
// this package is a standalone pnpm root and cannot import the workspace, so the values are mirrored,
// never invented. If the deployment ever moves, set E2E_ESCROW / E2E_USDC.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const e2eDir = fileURLToPath(new URL("..", import.meta.url));

/** Parse `KEY=value` lines from `e2e/.env` into `process.env` (idempotent; never overwrites). */
export function loadDotEnv(): void {
  const path = `${e2eDir}.env`;
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trimStart().startsWith("#")) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

loadDotEnv();

/** Base Sepolia — the only chain this harness ever touches (golden rule: testnet only). */
export const CHAIN_ID = 84532;

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
export const API_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:8787";
export const INDEXER_URL = process.env.E2E_INDEXER_URL ?? "http://127.0.0.1:8788";
export const RPC_URL = process.env.E2E_RPC_URL ?? "";
export const RECONCILE_TOKEN = process.env.E2E_RECONCILE_TOKEN ?? "";

/** Escrow + USDC, mirroring `escrowDeployments[84532]` in @buyananswer/shared. */
export const ESCROW = (process.env.E2E_ESCROW ??
  "0x40A4bfEc9441752BcABBd4b3939503671c8724dB") as `0x${string}`;
export const USDC = (process.env.E2E_USDC ??
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as `0x${string}`;

/**
 * True for runs that must talk to the real chain: the gated on-chain spec and the multi-actor harness.
 * Both need the API and the **indexer** to share one local D1 — see {@link SHARED_PERSIST_DIR}.
 */
export const liveChainRun = process.env.E2E_ONCHAIN === "1" || process.env.E2E_HARNESS === "1";

/**
 * A Miniflare state directory shared by every Worker in a live-chain run. By default each `wrangler
 * dev` persists under its OWN `workers/<x>/.wrangler/state`, so the indexer would write money-state
 * into a different SQLite file than the API reads — and nothing the harness pays for would ever appear
 * in the UI. Pointing both at one `--persist-to` restores the production topology (one shared D1,
 * ADR-0024). Under the repo-root `.wrangler/`, which is already git-ignored.
 */
export const SHARED_PERSIST_DIR = fileURLToPath(
  new URL("../../.wrangler/e2e-state", import.meta.url),
);

/** Where the generated keyset and the run state live (git-ignored). */
export const HARNESS_DIR = `${e2eDir}.harness`;
export const WALLETS_PATH = `${HARNESS_DIR}/wallets.json`;
export const STATE_PATH = `${HARNESS_DIR}/state.json`;
export const RESULTS_PATH = `${HARNESS_DIR}/last-run.json`;
