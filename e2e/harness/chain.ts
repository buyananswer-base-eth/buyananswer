// SPDX-License-Identifier: MIT
// Read-only chain access for the harness: balances, the escrow's pull-payment ledger, and its fee
// parameters. The harness NEVER writes to the chain from here — every transaction in this suite is sent
// by a real user action in the browser, through the headless wallet. These reads exist only to assert
// the money actually moved (chain = truth) and to preflight funding.
//
// The ABIs are a minimal inline mirror of @buyananswer/shared (this standalone package can't import the
// workspace) — the same deliberate trade-off ADR-0034 made for `onchain.spec.ts`.

import { expect } from "@playwright/test";
import { http, type Address, createPublicClient, formatEther, formatUnits, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";
import { type Actors, ROLES, type Role } from "./actors";
import { ESCROW, RPC_URL, USDC } from "./env";

export const usdcAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

export const escrowAbi = parseAbi([
  "function withdrawable(address account) view returns (uint256)",
  "function feeAddress() view returns (address)",
  "function answerFeeBps() view returns (uint16)",
  "function cancelFeeBps() view returns (uint16)",
  "function answerWindow() view returns (uint64)",
]);

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL || undefined),
});

export const usdcBalance = (address: Address): Promise<bigint> =>
  publicClient.readContract({
    address: USDC,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [address],
  });

export const ethBalance = (address: Address): Promise<bigint> =>
  publicClient.getBalance({ address });

/** USDC the escrow is currently allowed to pull from `owner` — decides which ask path the UI takes. */
export const usdcAllowance = (owner: Address): Promise<bigint> =>
  publicClient.readContract({
    address: USDC,
    abi: usdcAbi,
    functionName: "allowance",
    args: [owner, ESCROW],
  });

export const withdrawable = (address: Address): Promise<bigint> =>
  publicClient.readContract({
    address: ESCROW,
    abi: escrowAbi,
    functionName: "withdrawable",
    args: [address],
  });

/** The escrow's owner-set parameters, read once per run (never hardcoded — the contract is truth). */
export interface EscrowParams {
  feeAddress: Address;
  answerFeeBps: bigint;
  cancelFeeBps: bigint;
  answerWindowSeconds: bigint;
}

export async function readEscrowParams(): Promise<EscrowParams> {
  const [feeAddress, answerFeeBps, cancelFeeBps, answerWindow] = await Promise.all([
    publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: "feeAddress" }),
    publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: "answerFeeBps" }),
    publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: "cancelFeeBps" }),
    publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: "answerWindow" }),
  ]);
  return {
    feeAddress,
    answerFeeBps: BigInt(answerFeeBps),
    cancelFeeBps: BigInt(cancelFeeBps),
    answerWindowSeconds: BigInt(answerWindow),
  };
}

/**
 * Assert a chain read settles on `expected`, polling until it does.
 *
 * A single read right after a transaction confirms is NOT reliable: Base Sepolia's RPCs are
 * load-balanced and read-after-write inconsistent, so an `eth_call` can be served by a node that
 * hasn't applied the block the receipt already proved. Polling asserts the same fact without
 * weakening it — the value must still land exactly on `expected`, just not necessarily on the
 * first read.
 */
export async function expectEventually(
  read: () => Promise<bigint>,
  expected: bigint,
  message: string,
  timeout = 90_000,
): Promise<void> {
  await expect
    .poll(read, { message, timeout, intervals: [500, 1_000, 2_000, 3_000, 5_000] })
    .toBe(expected);
}

/** Fee on `amount` in basis points, floored — mirrors the contract's integer division exactly. */
export const feeOn = (amount: bigint, bps: bigint): bigint => (amount * bps) / 10_000n;

/** 6-dp USDC as a human string (display only — money is base-unit BigInt everywhere else). */
export const usdc = (base: bigint): string => `${formatUnits(base, 6)} USDC`;

export interface FundingRow {
  role: Role;
  address: Address;
  eth: bigint;
  usdc: bigint;
  needsUsdc: boolean;
}

/** Read every actor's gas + USDC balance in one pass (used by the preflight and the run report). */
export async function readFunding(actors: Actors): Promise<FundingRow[]> {
  return Promise.all(
    ROLES.map(async (role) => {
      const address = actors[role].address;
      const [eth, usdcBal] = await Promise.all([ethBalance(address), usdcBalance(address)]);
      return { role, address, eth, usdc: usdcBal, needsUsdc: role.startsWith("ASKER") };
    }),
  );
}

/**
 * Gas floor per actor and USDC floor per asker — below either, the money paths can't run. Base Sepolia
 * gas is ~0.006 gwei, and the busiest actor (ASKER_3: two asks + cancel + withdraw ≈ 575k gas) spends
 * well under 0.00001 ETH per full run, so 0.0002 ETH is dozens of runs of headroom. The floor exists to
 * catch "this wallet was never funded", not to demand a big balance.
 */
export const MIN_ETH = 200_000_000_000_000n; // 0.0002 ETH
export const MIN_USDC = 2_000_000n; // 2 USDC (ASKER_3 escrows two questions)

/**
 * Fail-soft preflight: returns a human "fund these addresses" message when any actor is short, or
 * `null` when the whole cast is ready. Mirrors `onchain.spec.ts`'s clean-skip contract.
 */
export function fundingShortfall(rows: FundingRow[]): string | null {
  const short = rows.filter((r) => r.eth < MIN_ETH || (r.needsUsdc && r.usdc < MIN_USDC));
  if (short.length === 0) return null;
  const lines = short.map((r) => {
    const missing: string[] = [];
    if (r.eth < MIN_ETH) missing.push(`ETH (has ${formatEther(r.eth)})`);
    if (r.needsUsdc && r.usdc < MIN_USDC) missing.push(`USDC (has ${formatUnits(r.usdc, 6)})`);
    return `  ${r.role.padEnd(11)} ${r.address}  needs ${missing.join(" + ")}`;
  });
  return [
    "Base Sepolia harness wallets are underfunded — fund these addresses, then re-run:",
    ...lines,
    "  ETH faucet: Coinbase Developer Platform / Alchemy / QuickNode · USDC faucet: https://faucet.circle.com (Base Sepolia)",
  ].join("\n");
}
