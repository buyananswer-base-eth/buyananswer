// SPDX-License-Identifier: MIT
// Session 15 — the named WRONG-NETWORK regression.
//
// Every money action in the app refuses to run on a chain that isn't ask-capable (a deployed escrow +
// USDC). All four money surfaces branch on the SAME pure predicate, `canAskOn(chainId)`:
//   • ask + pay   — app/hooks/useAskAndPay.ts  (→ phase "wrong-network")
//   • settle      — app/hooks/useSettleAction.ts
//   • withdraw    — app/hooks/useWithdraw.ts
//   • the ask UI  — app/components/ask/AskGate.tsx (AskWalletGate → <AskNetworkGuard/>)
// and the switch button targets DEFAULT_ASK_CHAIN. This locks that guard as DEFAULT-DENY: only a chain
// with a live escrow deployment passes; anything else is always blocked. The React wiring itself is
// exercised by the Playwright onboard/ask journeys (e2e/, ADR-0034); here we pin the predicate the
// wiring depends on.
//
// UPDATED at the Base-mainnet deploy (ADR-0038). Base mainnet was previously the headline example of a
// "supported but not ask-capable" chain — it is now LIVE, so the allow-list is {Base mainnet, Base
// Sepolia} and the default flipped to mainnet. Base Sepolia deliberately STAYS ask-capable: the e2e
// harness runs its money paths there, and de-listing it would silently break that whole tier.
// What must not change is the SHAPE of the guard: default-deny, driven solely by a live deployment.

import { BASE_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID } from "@buyananswer/shared";
import { base, baseSepolia } from "viem/chains";
import { describe, expect, it } from "vitest";
import { ASK_CHAINS, DEFAULT_ASK_CHAIN, canAskOn, isSupportedChainId } from "../app/lib/chains";

// A representative spread of "wrong" networks a wallet could be connected to when it hits a pay button.
const WRONG_NETWORKS: Array<[string, number | undefined]> = [
  ["Ethereum mainnet", 1],
  ["Optimism", 10],
  ["Arbitrum One", 42161],
  ["Polygon", 137],
  ["BNB Chain", 56],
  ["Avalanche", 43114],
  ["an unknown chain", 999_999],
  ["a disconnected wallet", undefined],
];

describe("regression: wrong-network guard (default-deny) blocks every money action", () => {
  it("refuses to pay/settle/withdraw on any non-ask-capable chain", () => {
    for (const [, chainId] of WRONG_NETWORKS) {
      expect(canAskOn(chainId)).toBe(false);
    }
  });

  it("allows the money path ONLY on chains with a live escrow deployment", () => {
    expect(canAskOn(BASE_CHAIN_ID)).toBe(true);
    expect(canAskOn(BASE_SEPOLIA_CHAIN_ID)).toBe(true);
    expect(canAskOn(base.id)).toBe(true);
    expect(canAskOn(baseSepolia.id)).toBe(true);
    // The allow-list is exactly {Base mainnet, Base Sepolia} — nothing else slips through.
    expect(ASK_CHAINS.map((c) => c.id)).toEqual([BASE_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID]);
  });

  it("points the 'switch network' prompt at Base MAINNET (the production escrow chain)", () => {
    expect(DEFAULT_ASK_CHAIN.id).toBe(BASE_CHAIN_ID);
    expect(DEFAULT_ASK_CHAIN.id).toBe(base.id);
  });

  it("still denies by default: an ask-capable chain requires BOTH an escrow and a USDC address", () => {
    // The guard is not a hardcoded allow-list — it is derived from the deployment records. A chain the
    // app "supports" for sign-in is still refused unless it has a live escrow (this is what kept Base
    // mainnet blocked right up until the deploy, and what blocks any future chain added to
    // SUPPORTED_CHAINS before its escrow exists).
    expect(isSupportedChainId(1)).toBe(false);
    expect(canAskOn(1)).toBe(false);
    for (const chainId of ASK_CHAINS.map((c) => c.id)) {
      expect(isSupportedChainId(chainId)).toBe(true);
    }
  });
});
