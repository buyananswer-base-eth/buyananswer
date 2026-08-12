// SPDX-License-Identifier: MIT
// The chain guard mirrors the API's ALLOWED_CHAIN_IDS and reads all chain metadata from
// @buyananswer/shared. These tests lock that contract in.

import { BASE_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID } from "@buyananswer/shared";
import { describe, expect, it } from "vitest";
import {
  ASK_CHAINS,
  DEFAULT_ASK_CHAIN,
  DEFAULT_CHAIN,
  SUPPORTED_CHAIN_IDS,
  canAskOn,
  chainName,
  escrowAddressFor,
  isSupportedChainId,
  usdcAddressFor,
} from "../app/lib/chains";

describe("chain guard", () => {
  it("supports exactly Base (8453) and Base Sepolia (84532)", () => {
    expect([...SUPPORTED_CHAIN_IDS].sort()).toEqual([8453, 84532]);
  });

  it("stays in lockstep with the shared Base Sepolia chain id", () => {
    expect(SUPPORTED_CHAIN_IDS).toContain(BASE_SEPOLIA_CHAIN_ID);
    expect(DEFAULT_CHAIN.id).toBe(BASE_SEPOLIA_CHAIN_ID);
  });

  it("accepts supported ids and rejects everything else", () => {
    expect(isSupportedChainId(84532)).toBe(true);
    expect(isSupportedChainId(8453)).toBe(true);
    expect(isSupportedChainId(1)).toBe(false);
    expect(isSupportedChainId(undefined)).toBe(false);
  });

  it("names known and unknown chains", () => {
    expect(chainName(84532).toLowerCase()).toContain("base");
    expect(chainName(undefined)).toBe("Unknown network");
    expect(chainName(999)).toBe("Chain 999");
  });

  it("reads escrow + USDC addresses for Base Sepolia from shared", () => {
    expect(escrowAddressFor(84532)).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(usdcAddressFor(84532)).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(escrowAddressFor(1)).toBeNull();
  });
});

describe("ask-capable chains", () => {
  it("only allows asking on a chain with BOTH a deployed escrow and USDC", () => {
    // Both Base chains are deployed (mainnet since ADR-0038); unknown chains are never ask-capable.
    expect(canAskOn(8453)).toBe(true);
    expect(canAskOn(84532)).toBe(true);
    expect(canAskOn(1)).toBe(false);
    expect(canAskOn(undefined)).toBe(false);
  });

  it("exposes only ask-capable supported chains, defaulting to Base mainnet", () => {
    // Order follows SUPPORTED_CHAINS = [base, baseSepolia], which is what makes mainnet the default.
    expect(ASK_CHAINS.map((c) => c.id)).toEqual([BASE_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID]);
    expect(DEFAULT_ASK_CHAIN.id).toBe(BASE_CHAIN_ID);
  });
});
