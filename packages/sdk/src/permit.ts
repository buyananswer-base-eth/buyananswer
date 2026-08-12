// SPDX-License-Identifier: MIT
// EIP-2612 permit helper for USDC. A permit lets the asker approve the escrow to pull `amount` USDC with
// a single off-chain signature (no separate approve tx), which the contract's `askQuestionWithPermit`
// then submits together with the ask (CONTRACT_SPEC §9). We build the EIP-712 typed data here and split
// the returned signature into (v, r, s); the actual signing is done by the caller's wallet (framework-
// agnostic — the web app signs via wagmi's `signTypedData`).
//
// Domain correctness matters: Circle's USDC uses the token `name()` (e.g. "USDC" on Base Sepolia,
// "USD Coin" on Base mainnet) and `version` "2". Read `name`/`nonces` on-chain (see usdcAbi) and pass
// them in so the domain is never hardcoded per network.

import type { Address } from "@buyananswer/shared";
import { type Hex, parseSignature } from "viem";

/** Default EIP-712 domain `version` for Circle's USDC (FiatToken v2). */
export const USDC_PERMIT_VERSION = "2";

/** The EIP-2612 `Permit` type (owner, spender, value, nonce, deadline). */
export const USDC_PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** Inputs to build a USDC permit's EIP-712 typed data. */
export interface UsdcPermitInput {
  /** EVM chain id (goes in the EIP-712 domain). */
  chainId: number;
  /** The USDC token address (EIP-712 `verifyingContract`). */
  token: Address;
  /** Token `name()` read on-chain (EIP-712 domain `name`). */
  name: string;
  /** EIP-712 domain `version`; defaults to {@link USDC_PERMIT_VERSION} ("2"). */
  version?: string;
  /** The token holder granting the allowance (the asker). */
  owner: Address;
  /** The spender being approved (the escrow contract). */
  spender: Address;
  /** Allowance the permit grants, in base units; must be ≥ the escrow amount. */
  value: bigint;
  /** The owner's current permit `nonce`, read on-chain. */
  nonce: bigint;
  /** Unix-seconds signature deadline. */
  deadline: bigint;
}

/** A fully-formed EIP-712 typed-data payload ready to hand to a wallet's `signTypedData`. */
export interface UsdcPermitTypedData {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: Address;
  };
  types: typeof USDC_PERMIT_TYPES;
  primaryType: "Permit";
  message: {
    owner: Address;
    spender: Address;
    value: bigint;
    nonce: bigint;
    deadline: bigint;
  };
}

/**
 * Build the EIP-712 typed data for a USDC EIP-2612 permit. The caller signs the returned object with
 * their wallet and passes the signature to {@link splitPermitSignature}.
 */
export function buildUsdcPermitTypedData(input: UsdcPermitInput): UsdcPermitTypedData {
  return {
    domain: {
      name: input.name,
      version: input.version ?? USDC_PERMIT_VERSION,
      chainId: input.chainId,
      verifyingContract: input.token,
    },
    types: USDC_PERMIT_TYPES,
    primaryType: "Permit",
    message: {
      owner: input.owner,
      spender: input.spender,
      value: input.value,
      nonce: input.nonce,
      deadline: input.deadline,
    },
  };
}

/** The (v, r, s) triple `askQuestionWithPermit` expects, split from a 65-byte signature. */
export interface PermitSignatureParts {
  v: number;
  r: Hex;
  s: Hex;
}

/**
 * Split a 65-byte EIP-712 signature into the `(v, r, s)` the contract's permit path takes. Normalizes
 * viem's `yParity` back to the legacy `v` (27/28) when a token's `ecrecover`-based permit needs it.
 */
export function splitPermitSignature(signature: Hex): PermitSignatureParts {
  const { r, s, v, yParity } = parseSignature(signature);
  const vNum = v !== undefined ? Number(v) : yParity + 27;
  return { v: vNum, r, s };
}
