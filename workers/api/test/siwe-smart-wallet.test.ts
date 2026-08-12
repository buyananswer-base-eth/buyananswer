// SPDX-License-Identifier: MIT
// Session 19 — named regression for SMART-CONTRACT-WALLET SIGN-IN (ADR-0039).
//
// THE BUG THIS PINS: `verifySiwe` was EOA-only. It recovered the signer with secp256k1 and compared
// addresses, so any wallet that authorizes via **ERC-1271** (`isValidSignature`) rather than a
// recoverable ECDSA signature was rejected outright with "signature_mismatch". That silently locked
// out Coinbase Smart Wallet — the flagship wallet on Base, the chain this product runs on — plus
// Safe and every EIP-7702-delegated account. Users saw only "we couldn't verify that signature",
// which points at their wallet rather than at us.
//
// The properties that must not regress:
//   • The EOA path stays LOCAL. It must never need the network, or the suite stops being hermetic
//     and sign-in gains an RPC dependency it does not need.
//   • Verification FAILS CLOSED. An RPC outage, a timeout, or a malformed response must never be
//     read as a valid signature — that would be an authentication bypass, the worst bug this
//     codebase could have.
//   • Without an RPC configured, a contract signature is REJECTED, not accepted.

import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifySiwe } from "../src/auth/siwe.js";
import { ALICE_PK, DOMAIN, ORIGIN } from "./helpers.js";

const NONCE = "0123456789abcdef0123456789abcdef";
/** A deployed smart account (any address); its signature is not ECDSA-recoverable to itself. */
const SMART_WALLET = "0xE0f0275d3Db47d9DcD056766b02fc7606F36cc43" as const;

function message(address: `0x${string}`, chainId = 84532): string {
  return createSiweMessage({
    address,
    chainId,
    domain: DOMAIN,
    uri: ORIGIN,
    nonce: NONCE,
    version: "1",
    statement: "Sign in to BuyAnAnswer.",
  });
}

const base = { domain: DOMAIN, nonce: NONCE };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("regression: SIWE accepts smart-contract wallets without weakening EOA verification", () => {
  it("verifies an EOA signature WITHOUT touching the network", async () => {
    const acct = privateKeyToAccount(ALICE_PK);
    const msg = message(acct.address);
    const signature = await acct.signMessage({ message: msg });

    // Any network call on the EOA path is a regression: sign-in must work with no RPC configured.
    const fetchSpy = vi.fn(() => Promise.reject(new Error("network must not be used")));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await verifySiwe({ ...base, message: msg, signature });
    expect(result).toEqual({ ok: true, address: acct.address.toLowerCase() });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-recoverable (contract) signature when NO rpc is configured", async () => {
    // A signature that is well-formed but does not recover to the claimed smart-wallet address.
    const acct = privateKeyToAccount(ALICE_PK);
    const msg = message(SMART_WALLET);
    const signature = await acct.signMessage({ message: msg });

    const result = await verifySiwe({ ...base, message: msg, signature });
    expect(result).toEqual({ ok: false, error: "signature_mismatch" });
  });

  it("FAILS CLOSED when the RPC is unreachable — an outage is never a valid signature", async () => {
    const acct = privateKeyToAccount(ALICE_PK);
    const msg = message(SMART_WALLET);
    const signature = await acct.signMessage({ message: msg });

    vi.stubGlobal("fetch", () => Promise.reject(new Error("RPC down")));

    const result = await verifySiwe({
      ...base,
      message: msg,
      signature,
      rpcUrl: "https://rpc.example.invalid",
    });
    expect(result.ok).toBe(false);
    expect(result).toEqual({ ok: false, error: "verification_unavailable" });
  });

  it("FAILS CLOSED when the account contract says the signature is NOT valid", async () => {
    const acct = privateKeyToAccount(ALICE_PK);
    const msg = message(SMART_WALLET);
    const signature = await acct.signMessage({ message: msg });

    // eth_call returning 0x = isValidSignature did not return the ERC-1271 magic value.
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x" }), {
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const result = await verifySiwe({
      ...base,
      message: msg,
      signature,
      rpcUrl: "https://rpc.example.invalid",
    });
    expect(result.ok).toBe(false);
  });

  it("still enforces domain binding and the nonce for smart wallets", async () => {
    const acct = privateKeyToAccount(ALICE_PK);
    const msg = message(SMART_WALLET);
    const signature = await acct.signMessage({ message: msg });

    // Wrong domain must be rejected on message validation, BEFORE any signature work — so a
    // smart wallet can never be used to sidestep the domain binding.
    const wrongDomain = await verifySiwe({
      ...base,
      domain: "evil.example",
      message: msg,
      signature,
      rpcUrl: "https://rpc.example.invalid",
    });
    expect(wrongDomain).toEqual({ ok: false, error: "invalid_message" });

    const wrongNonce = await verifySiwe({
      ...base,
      nonce: "ffffffffffffffffffffffffffffffff",
      message: msg,
      signature,
      rpcUrl: "https://rpc.example.invalid",
    });
    expect(wrongNonce).toEqual({ ok: false, error: "invalid_message" });
  });
});
