// SPDX-License-Identifier: MIT
// SIWE (Sign-In With Ethereum, EIP-4361) verification. The signer is established *cryptographically*
// and the exact domain + single-use nonce + time window + chain id are bound (FUNCTIONAL_SPEC §11).
//
// TWO SIGNER KINDS, verified in order (ADR-0039):
//
//  1. **EOA** — `recoverMessageAddress` recovers the signer locally via secp256k1. No RPC, so this
//     path works offline and keeps the test suite hermetic.
//  2. **Smart-contract wallet** — Coinbase Smart Wallet, Safe, and any EIP-7702-delegated account
//     do NOT produce a recoverable ECDSA signature; they authorize via **ERC-1271**
//     (`isValidSignature`), or **ERC-6492** when the account is still counterfactual. Those are
//     verified by CALLING THE CHAIN, which needs an RPC.
//
// This was originally EOA-only and deferred (ADR-0022), which silently locked out every smart
// wallet — including Coinbase Smart Wallet, the flagship wallet on Base. Users saw only
// "we couldn't verify that signature".
//
// SECURITY NOTE on where the address comes from. The EOA path *recovers* the address and compares
// it to the message's. The contract path cannot recover anything, so it verifies the signature
// AGAINST the address named in the message. That is still sound — `verifyMessage` asks the account
// contract itself whether the signature is valid for that exact message — but it means the address
// is only ever trusted after a cryptographic check, never because the client claimed it.

import type { Address } from "@buyananswer/shared";
import { http, createPublicClient, getAddress, recoverMessageAddress } from "viem";
import { base, baseSepolia } from "viem/chains";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { ALLOWED_CHAIN_IDS } from "../env.js";

export interface VerifySiweParams {
  /** The raw SIWE message string exactly as signed. */
  message: string;
  /** The signature over `message` (0x-hex). */
  signature: `0x${string}`;
  /** The domain the request was served on — must equal the message's `domain` (binding). */
  domain: string;
  /** The nonce we issued and just consumed — must equal the message's `nonce` (replay-safe). */
  nonce: string;
  /**
   * RPC URL used ONLY to verify smart-contract-wallet signatures (ERC-1271 / ERC-6492) by calling
   * the account contract. Omit and EOA sign-in still works, but every smart wallet is rejected.
   */
  rpcUrl?: string | undefined;
}

export type VerifySiweResult = { ok: true; address: Address } | { ok: false; error: string };

/** Verify a SIWE message + signature. Returns the lowercased signer address on success. */
export async function verifySiwe(params: VerifySiweParams): Promise<VerifySiweResult> {
  const fields = parseSiweMessage(params.message);
  if (!fields.address) return { ok: false, error: "missing_address" };

  // Field-level checks: domain binding, nonce match, expiry / not-before. Signature not yet checked.
  const fieldsValid = validateSiweMessage({
    message: fields,
    domain: params.domain,
    nonce: params.nonce,
    time: new Date(),
  });
  if (!fieldsValid) return { ok: false, error: "invalid_message" };

  // Restrict to Base / Base Sepolia — validateSiweMessage does not check chainId.
  if (fields.chainId === undefined || !ALLOWED_CHAIN_IDS.includes(fields.chainId)) {
    return { ok: false, error: "unsupported_chain" };
  }

  const claimed = getAddress(fields.address);

  // 1. EOA fast path — local secp256k1 recovery, no network. Most wallets land here.
  try {
    const recovered = await recoverMessageAddress({
      message: params.message,
      signature: params.signature,
    });
    if (getAddress(recovered) === claimed) {
      return { ok: true, address: recovered.toLowerCase() as Address };
    }
  } catch {
    // Not a recoverable ECDSA signature — could still be a contract signature. Fall through.
  }

  // 2. Smart-contract wallet — ask the account contract itself (ERC-1271), or the ERC-6492 wrapper
  //    if it has not been deployed yet. Requires an RPC on the message's chain.
  if (!params.rpcUrl) return { ok: false, error: "signature_mismatch" };

  const chain = fields.chainId === base.id ? base : baseSepolia;
  const client = createPublicClient({ chain, transport: http(params.rpcUrl) });

  let valid = false;
  try {
    valid = await client.verifyMessage({
      address: claimed,
      message: params.message,
      signature: params.signature,
    });
  } catch {
    valid = false; // Any throw is a rejection — never a pass. Fail closed.
  }
  if (valid) return { ok: true, address: claimed.toLowerCase() as Address };

  // viem's `verifyMessage` COLLAPSES "the contract said no" and "the RPC was unreachable" into a
  // plain `false`. Both must reject — but reporting them identically means an RPC outage shows up
  // in the logs as a wave of bad signatures, sending you to debug the wrong system. One cheap probe
  // on the failure path only (never on a successful login) tells the two apart.
  try {
    await client.getChainId();
  } catch {
    return { ok: false, error: "verification_unavailable" };
  }
  return { ok: false, error: "signature_mismatch" };
}
