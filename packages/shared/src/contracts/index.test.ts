// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_USDC,
  buyAnAnswerEscrowAbi,
  escrowDeployments,
  getEscrowDeployment,
  requireEscrowAddress,
} from "./index.js";

describe("escrow contract artifact", () => {
  it("exposes a non-empty ABI with the core escrow surface", () => {
    expect(buyAnAnswerEscrowAbi.length).toBeGreaterThan(0);
    const namesOf = (type: string): string[] =>
      buyAnAnswerEscrowAbi.flatMap((e) => (e.type === type && "name" in e ? [e.name] : []));

    const fns = namesOf("function");
    for (const name of ["askQuestion", "answerQuestion", "reclaimQuestion", "withdraw"]) {
      expect(fns).toContain(name);
    }
    // QuestionAsked event must be present for the indexer to bind to.
    expect(namesOf("event")).toContain("QuestionAsked");
  });

  it("has a Base Sepolia deployment record with the testnet USDC", () => {
    const d = getEscrowDeployment(BASE_SEPOLIA_CHAIN_ID);
    expect(d).toBeDefined();
    expect(d?.chainId).toBe(84532);
    expect(d?.usdc).toBe(BASE_SEPOLIA_USDC);
    expect(escrowDeployments[BASE_SEPOLIA_CHAIN_ID].network).toBe("base-sepolia");
  });

  it("returns undefined for an unknown chain", () => {
    expect(getEscrowDeployment(1)).toBeUndefined();
  });

  it("requireEscrowAddress throws until an address is recorded", () => {
    const d = escrowDeployments[BASE_SEPOLIA_CHAIN_ID];
    if (d.address === null) {
      expect(() => requireEscrowAddress(BASE_SEPOLIA_CHAIN_ID)).toThrow();
    } else {
      expect(requireEscrowAddress(BASE_SEPOLIA_CHAIN_ID)).toBe(d.address);
    }
  });
});
