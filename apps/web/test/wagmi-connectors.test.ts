// SPDX-License-Identifier: MIT
// Session 21 — named regression: THE FARCASTER CONNECTOR IS NEVER PRESENT ON THE OPEN WEB.
//
// THE BUG THIS PINS: the Mini App connector was added to the wagmi config unconditionally, on the
// assumption it would report itself unavailable outside a Farcaster client. It does not degrade
// that cleanly. On the open web it broke `writeContract` with
// "connector.getChainId is not a function" — which reached a user mid-settle as "Something went
// wrong" on a real mainnet cancel. Every money action (ask, answer, decline, cancel, reclaim,
// withdraw) goes through `writeContract`, so this put the whole settle surface at risk.
//
// Nothing caught it: the connector list is never exercised by unit tests, typecheck is happy
// either way, and it only fails at the moment a wallet is asked to sign.
//
// The rule is simple and worth keeping simple: the Farcaster connector is included ONLY when we
// have positively confirmed we are inside a Farcaster client. (ADR-0044)

import { describe, expect, it, vi } from "vitest";

// A wagmi connector is a FUNCTION of the config, not a plain object — mock it in that shape so the
// test exercises the real createConfig path rather than failing on the mock.
vi.mock("@farcaster/miniapp-wagmi-connector", () => ({
  default: () => () => ({
    id: "farcaster",
    name: "Farcaster",
    type: "farcasterMiniApp",
    connect: async () => ({ accounts: [], chainId: 8453 }),
    disconnect: async () => {},
    getAccounts: async () => [],
    getChainId: async () => 8453,
    getProvider: async () => undefined,
    isAuthorized: async () => false,
    onAccountsChanged: () => {},
    onChainChanged: () => {},
    onDisconnect: () => {},
  }),
}));

async function connectorIds(inMiniApp: boolean): Promise<string[]> {
  vi.resetModules();
  const { getWagmiConfig } = await import("../app/lib/wagmi");
  return getWagmiConfig(inMiniApp).connectors.map((c) => c.id);
}

describe("regression: wagmi connector set by host", () => {
  it("does NOT include the Farcaster connector on the open web", async () => {
    const ids = await connectorIds(false);
    expect(ids).not.toContain("farcaster");
    expect(ids.length).toBeGreaterThan(0); // the ordinary wallets are still there
  });

  it("defaults to the open-web set when called with no argument", async () => {
    // The default must be the SAFE one: a caller that forgets the flag gets the working config.
    const ids = await connectorIds(undefined as unknown as boolean);
    expect(ids).not.toContain("farcaster");
  });

  it("includes it — first, so it wins auto-connect — inside a Farcaster client", async () => {
    const ids = await connectorIds(true);
    expect(ids[0]).toBe("farcaster");
  });

  it("keeps the ordinary wallet connectors in BOTH hosts", async () => {
    // A Mini App user may still choose another wallet; removing these would strand them.
    for (const host of [true, false]) {
      const ids = await connectorIds(host);
      expect(ids).toContain("injected");
      expect(ids.some((id) => id.toLowerCase().includes("coinbase"))).toBe(true);
    }
  });
});
