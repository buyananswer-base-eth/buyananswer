// SPDX-License-Identifier: MIT
// Per-chain deployment records for `BuyAnAnswerEscrow`. Hand-maintained (unlike the generated
// ABI): after each `forge script --broadcast`, record the deployed address + the block it landed
// in (the indexer's backfill start cursor). `address`/`startBlock` are `null` until deployed.

/** A hex address (checksummed) — kept as a plain template-literal type so `shared` stays dep-free. */
export type Address = `0x${string}`;

/** A single on-chain deployment of the escrow. */
export interface EscrowDeployment {
  /** EVM chain id (e.g. 84532 = Base Sepolia). */
  readonly chainId: number;
  /** Human-readable network name. */
  readonly network: string;
  /** Deployed escrow address, or `null` until it has been broadcast + recorded. */
  readonly address: Address | null;
  /** Block the deploy tx landed in — the indexer backfills from here. `null` until deployed. */
  readonly startBlock: number | null;
  /** USDC token the escrow was constructed with on this chain. */
  readonly usdc: Address;
  /** Block-explorer base URL for this chain. */
  readonly explorer: string;
}

/** Base Sepolia testnet chain id. */
export const BASE_SEPOLIA_CHAIN_ID = 84532;

/** Base mainnet chain id. */
export const BASE_CHAIN_ID = 8453;

/** Circle's native testnet USDC on Base Sepolia (6 decimals). */
export const BASE_SEPOLIA_USDC: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

/**
 * Circle's **native** USDC on Base mainnet (6 decimals). Verified in Session 19 three independent
 * ways before being written here: Circle's official contract-address list, an on-chain
 * `name()`/`symbol()`/`decimals()` read against Base mainnet, and an EIP-55 checksum match.
 * This is native USDC, NOT the bridged `USDbC` — do not substitute one for the other.
 */
export const BASE_USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/**
 * All known escrow deployments, keyed by chain id. **Base mainnet is LIVE** and is now the app's
 * default ask chain; Base Sepolia stays deployed and ask-capable for testing and the e2e harness.
 *
 * ⚠ These records drive real behaviour, not just docs. `apps/web/app/lib/chains.ts` derives
 * `ASK_CHAINS = SUPPORTED_CHAINS.filter(canAskOn)` and `DEFAULT_ASK_CHAIN = ASK_CHAINS[0]` from a
 * non-null `address`, over `SUPPORTED_CHAINS = [base, baseSepolia]` — so the ORDER of that array is
 * what makes Base mainnet the default. The indexer likewise refuses to start on a chain whose
 * `address`/`startBlock` are null. Changing either field here changes where real money moves.
 * `startBlock` is the indexer's backfill floor and must stay the exact deploy block (ADR-0038).
 */
export const escrowDeployments = {
  [BASE_SEPOLIA_CHAIN_ID]: {
    chainId: BASE_SEPOLIA_CHAIN_ID,
    network: "base-sepolia",
    // Deployed + verified in Session 4 (deployer/owner/fee = project wallet, ADR-0020).
    address: "0x40A4bfEc9441752BcABBd4b3939503671c8724dB",
    startBlock: 45_351_822,
    usdc: BASE_SEPOLIA_USDC,
    explorer: "https://sepolia.basescan.org",
  },
  [BASE_CHAIN_ID]: {
    chainId: BASE_CHAIN_ID,
    network: "base",
    // LIVE. Deployed + verified on Base mainnet 2026-08-12 (ADR-0038).
    // tx 0x543c7b80cf6d7ca3e7f7b18b9914b667e75d45303deabfd8cc52e4fea5d6daca
    // owner = Safe 0xEc1276A188df9603fE280a42eBbeB90f32aa6034 · fee = 0xE0f0275d…cc43
    address: "0x04a814daa6421D5B0C7f3758476f0150D48198b6",
    startBlock: 49_867_011,
    usdc: BASE_USDC,
    explorer: "https://basescan.org",
  },
} as const satisfies Record<number, EscrowDeployment>;

/** Chain ids that have a deployment record. */
export type SupportedChainId = keyof typeof escrowDeployments;

/** Look up the escrow deployment for a chain id, if one exists. */
export function getEscrowDeployment(chainId: number): EscrowDeployment | undefined {
  return (escrowDeployments as Record<number, EscrowDeployment>)[chainId];
}

/**
 * Like {@link getEscrowDeployment} but throws unless the escrow has actually been deployed
 * (non-null `address`). Use where a bound contract address is required.
 */
export function requireEscrowAddress(chainId: number): Address {
  const d = getEscrowDeployment(chainId);
  if (!d || d.address === null) {
    throw new Error(`No deployed BuyAnAnswerEscrow for chain ${chainId}`);
  }
  return d.address;
}
