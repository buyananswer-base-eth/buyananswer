// SPDX-License-Identifier: MIT
// Session 19 — named regression for the MAINNET RPC SELECTION gap.
//
// Until this session `resolveConfig` read only `RPC_URL_BASE_SEPOLIA`, so pointing the indexer at
// Base mainnet (CHAIN_ID=8453) silently produced `rpcUrl: undefined` — viem then falls back to its
// DEFAULT PUBLIC endpoint no matter what the operator configured. That is the exact class of
// endpoint behind the Session-18 F1 defect (load-balanced, read-after-write inconsistent —
// ADR-0037), and public Base endpoints also cap `eth_getLogs` hard, so a production backfill would
// have crawled or stalled with no error to point at.
//
// This pins the per-chain selection so a mainnet misconfiguration can never regress to silence.
// (ADR-0038)

import { BASE_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID } from "@buyananswer/shared";
import { describe, expect, it } from "vitest";
import { type Env, resolveRpcUrl } from "../src/env.js";

const SEPOLIA_URL = "https://sepolia.example.invalid/key";
const MAINNET_URL = "https://mainnet.example.invalid/key";
const GENERIC_URL = "https://generic.example.invalid/key";

/** Only the RPC-bearing fields matter here; the rest of Env is irrelevant to the selection. */
function env(partial: Partial<Env>): Env {
  return partial as Env;
}

describe("regression: the indexer picks the RPC URL for the chain it is indexing", () => {
  it("uses RPC_URL_BASE on mainnet — never the Sepolia secret", () => {
    const e = env({ RPC_URL_BASE: MAINNET_URL, RPC_URL_BASE_SEPOLIA: SEPOLIA_URL });
    expect(resolveRpcUrl(e, BASE_CHAIN_ID)).toBe(MAINNET_URL);
  });

  it("uses RPC_URL_BASE_SEPOLIA on testnet — never the mainnet secret", () => {
    const e = env({ RPC_URL_BASE: MAINNET_URL, RPC_URL_BASE_SEPOLIA: SEPOLIA_URL });
    expect(resolveRpcUrl(e, BASE_SEPOLIA_CHAIN_ID)).toBe(SEPOLIA_URL);
  });

  it("THE BUG: a mainnet indexer configured only with the Sepolia secret does NOT silently use it", () => {
    // Pre-fix this returned SEPOLIA_URL for chain 8453 — indexing mainnet through a testnet RPC.
    const e = env({ RPC_URL_BASE_SEPOLIA: SEPOLIA_URL });
    expect(resolveRpcUrl(e, BASE_CHAIN_ID)).toBeUndefined();
  });

  it("falls back to the chain-agnostic RPC_URL when the chain-specific var is unset", () => {
    const e = env({ RPC_URL: GENERIC_URL });
    expect(resolveRpcUrl(e, BASE_CHAIN_ID)).toBe(GENERIC_URL);
    expect(resolveRpcUrl(e, BASE_SEPOLIA_CHAIN_ID)).toBe(GENERIC_URL);
  });

  it("prefers the chain-specific var over the generic fallback", () => {
    const e = env({ RPC_URL_BASE: MAINNET_URL, RPC_URL: GENERIC_URL });
    expect(resolveRpcUrl(e, BASE_CHAIN_ID)).toBe(MAINNET_URL);
  });

  it("treats blank/whitespace-only values as unset rather than as a URL", () => {
    expect(resolveRpcUrl(env({ RPC_URL_BASE: "   " }), BASE_CHAIN_ID)).toBeUndefined();
    expect(resolveRpcUrl(env({ RPC_URL_BASE: "", RPC_URL: GENERIC_URL }), BASE_CHAIN_ID)).toBe(
      GENERIC_URL,
    );
  });

  it("returns undefined when nothing is configured (viem's public default — testnet only)", () => {
    expect(resolveRpcUrl(env({}), BASE_CHAIN_ID)).toBeUndefined();
  });
});
