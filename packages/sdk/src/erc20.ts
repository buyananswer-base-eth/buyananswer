// SPDX-License-Identifier: MIT
// The slice of the ERC-20 + EIP-2612 surface the ask/pay flow touches on USDC. We keep our own minimal
// ABI (rather than viem's `erc20Abi`) because the money path also needs the permit reads (`nonces`,
// `name`, `version`) to build an EIP-2612 signature — see permit.ts. USDC is a standard, non-rebasing
// 6-decimal token; amounts are always base-unit `bigint` (never a JS number / float).

import type { Address } from "@buyananswer/shared";
import { type Hex, encodeFunctionData } from "viem";

/** Minimal USDC ABI: balance/allowance/approve plus the EIP-2612 permit reads. */
export const usdcAbi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "version",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

/**
 * Encode an ERC-20 `approve(spender, amount)` call — the approve half of the approve+ask fallback used
 * when EIP-2612 permit is unavailable. `amount` is USDC base units.
 */
export function encodeApprove(spender: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: usdcAbi, functionName: "approve", args: [spender, amount] });
}
