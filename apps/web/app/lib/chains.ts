// SPDX-License-Identifier: MIT
// The client's view of supported chains. Chain ids, escrow addresses, and USDC tokens are read from
// @buyananswer/shared (never hardcoded literals) so the web app, the API, and the on-chain SDK all
// agree. Session 9 only needs the chain *guard*; the escrow/USDC lookups are here for Session 11.

import { BASE_SEPOLIA_CHAIN_ID, getEscrowDeployment } from "@buyananswer/shared";
import type { Address } from "@buyananswer/shared";
import type { Chain } from "viem";
import { base, baseSepolia } from "viem/chains";

// Fail loudly if viem's Base Sepolia id ever drifts from the shared constant the API binds against.
if (baseSepolia.id !== BASE_SEPOLIA_CHAIN_ID) {
  throw new Error(
    `Base Sepolia chain id mismatch: viem=${baseSepolia.id} shared=${BASE_SEPOLIA_CHAIN_ID}`,
  );
}

/** Chains a wallet may be connected on — mirrors the API's ALLOWED_CHAIN_IDS ([8453, 84532]). */
export const SUPPORTED_CHAINS = [base, baseSepolia] as const;

/** The dev-default target (Base Sepolia). Mainnet (Base) is gated on a Safe migration (ADR-0012). */
export const DEFAULT_CHAIN: Chain = baseSepolia;

/** Numeric ids of {@link SUPPORTED_CHAINS}. */
export const SUPPORTED_CHAIN_IDS: readonly number[] = SUPPORTED_CHAINS.map((c) => c.id);

/** True when `chainId` is one the app (and the API's SIWE verify) accepts. */
export function isSupportedChainId(chainId: number | undefined): chainId is number {
  return chainId !== undefined && SUPPORTED_CHAIN_IDS.includes(chainId);
}

/** Human-readable name for a chain id, falling back gracefully for unknown networks. */
export function chainName(chainId: number | undefined): string {
  const known = SUPPORTED_CHAINS.find((c) => c.id === chainId);
  if (known) return known.name;
  return chainId === undefined ? "Unknown network" : `Chain ${chainId}`;
}

/** Deployed escrow address for a chain, or null when there is no deployment record (Session 11). */
export function escrowAddressFor(chainId: number | undefined): Address | null {
  if (chainId === undefined) return null;
  return getEscrowDeployment(chainId)?.address ?? null;
}

/** USDC token address for a chain, or null when unknown (Session 11). */
export function usdcAddressFor(chainId: number | undefined): Address | null {
  if (chainId === undefined) return null;
  return getEscrowDeployment(chainId)?.usdc ?? null;
}

/** Block-explorer base URL for a chain, or null when unknown. */
export function explorerFor(chainId: number | undefined): string | null {
  if (chainId === undefined) return null;
  return getEscrowDeployment(chainId)?.explorer ?? null;
}

/**
 * True when a chain can host an ask: it has BOTH a deployed escrow and a USDC address. A wallet may be
 * on a supported chain (Base or Base Sepolia) yet not be ask-capable — e.g. Base mainnet, which has no
 * escrow deployment yet — so the ask flow guards on this, not just {@link isSupportedChainId}.
 */
export function canAskOn(chainId: number | undefined): boolean {
  return escrowAddressFor(chainId) !== null && usdcAddressFor(chainId) !== null;
}

/** Supported chains that are also ask-capable (a deployed escrow + USDC). */
export const ASK_CHAINS = SUPPORTED_CHAINS.filter((c) => canAskOn(c.id));

/** The default chain to prompt a switch to when asking (currently Base Sepolia). */
export const DEFAULT_ASK_CHAIN: Chain = ASK_CHAINS[0] ?? DEFAULT_CHAIN;
