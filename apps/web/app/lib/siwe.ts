// SPDX-License-Identifier: MIT
// Build the SIWE (EIP-4361) message the wallet signs. We use viem/siwe `createSiweMessage` — the same
// library the API parses/validates with (viem/siwe on the Worker), so the message is guaranteed to
// round-trip. The API binds `domain` to the request Host and consumes the `nonce` (ADR-0022), so the
// caller must pass `window.location.host` as `domain` and a `chainId` in [8453, 84532].

import { getAddress } from "viem";
import { createSiweMessage } from "viem/siwe";

/**
 * The human-readable statement shown in the wallet's signature prompt.
 *
 * This is the ONE line of that prompt we control — everything else (address, domain, nonce, chain,
 * timestamps) is EIP-4361 boilerplate the wallet renders verbatim. So it has to do two jobs at
 * once: say what the user is agreeing to, and reassure them this is not a payment. "Sign in to
 * BuyAnAnswer" did the first only, and a bare signature request with no cost stated is exactly what
 * users have been trained to be suspicious of.
 *
 * Keep it one sentence — wallets truncate, and Coinbase Wallet in particular gives it little room.
 */
export const SIWE_STATEMENT =
  "Sign in to BuyAnAnswer. This is free, moves no funds, and approves no transaction.";

export interface BuildSiweInput {
  /** The signer's address (any casing; checksummed internally as SIWE requires). */
  address: string;
  /** The chain the wallet is on — must match the connected chain and be app-supported. */
  chainId: number;
  /** The host the app is served on (`window.location.host`) — the API binds this exact value. */
  domain: string;
  /** The full app origin (`window.location.origin`). */
  uri: string;
  /** The single-use nonce from `POST /auth/nonce`. */
  nonce: string;
  /** Optional issue time (defaults to now); injectable for deterministic tests. */
  issuedAt?: Date;
}

/** Produce the exact SIWE message string to sign. */
export function buildSiweMessage(input: BuildSiweInput): string {
  return createSiweMessage({
    address: getAddress(input.address),
    chainId: input.chainId,
    domain: input.domain,
    uri: input.uri,
    nonce: input.nonce,
    version: "1",
    statement: SIWE_STATEMENT,
    ...(input.issuedAt ? { issuedAt: input.issuedAt } : {}),
  });
}
