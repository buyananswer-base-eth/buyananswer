// SPDX-License-Identifier: MIT
// wagmi config. Built lazily (client-only) and memoized — `createConfig` and the connectors are only
// evaluated in the browser, so SSR never touches wallet libraries (this module is dynamically
// imported by Web3Provider). Chains come from ./chains, which reads ids from @buyananswer/shared.
//
// Connectors: injected + Coinbase Wallet always; WalletConnect only when a project id is configured
// (VITE_WALLETCONNECT_PROJECT_ID) so dev and CI need no WalletConnect Cloud account.

import { base, baseSepolia } from "viem/chains";
import { http, createConfig } from "wagmi";
import type { Config } from "wagmi";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import { SUPPORTED_CHAINS } from "./chains";

let config: Config | undefined;

function walletConnectProjectId(): string | undefined {
  const raw = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

/**
 * Read a configured RPC URL, or `undefined` to let viem/wagmi use the chain's DEFAULT PUBLIC
 * endpoint.
 *
 * That default is what shipped before Session 19, and on Base mainnet it resolves to the
 * load-balanced public endpoint whose read-after-write inconsistency caused the Session-18 F1
 * defect (a fresh `approve` not yet visible to the very next `allowance` read — ADR-0037). The
 * `allowance` poll added in ADR-0037 is the belt; a consistent private provider is the braces.
 * Production sets these (ADR-0038).
 *
 * ⚠ These are VITE_-prefixed, so they are BAKED INTO THE CLIENT BUNDLE and publicly readable.
 * Use a provider key that is domain-restricted (or otherwise safe to publish) — never a key that
 * also grants write/admin scope, and never the same unrestricted key the indexer or deploy uses.
 */
function rpcUrl(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
}

/** Get (or lazily build) the wagmi config. Call only on the client. */
export function getWagmiConfig(): Config {
  if (config) return config;

  const projectId = walletConnectProjectId();
  const connectors = [
    injected(),
    coinbaseWallet({ appName: "BuyAnAnswer" }),
    ...(projectId ? [walletConnect({ projectId })] : []),
  ];

  config = createConfig({
    chains: SUPPORTED_CHAINS,
    connectors,
    transports: {
      [base.id]: http(rpcUrl(import.meta.env.VITE_BASE_RPC_URL)),
      [baseSepolia.id]: http(rpcUrl(import.meta.env.VITE_BASE_SEPOLIA_RPC_URL)),
    },
    ssr: true,
  });
  return config;
}
