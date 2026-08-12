// SPDX-License-Identifier: MIT
import { serializeSignature, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  USDC_PERMIT_TYPES,
  USDC_PERMIT_VERSION,
  buildUsdcPermitTypedData,
  splitPermitSignature,
} from "./permit.js";

// A deterministic throwaway test key (never used anywhere real).
const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const account = privateKeyToAccount(PK);
const TOKEN = "0x036cbd53842c5426634e7929541ec2318f3dcf7e" as const;
const SPENDER = "0x40a4bfec9441752bcabbd4b3939503671c8724db" as const;

function baseInput() {
  return {
    chainId: 84532,
    token: TOKEN,
    name: "USDC",
    owner: account.address,
    spender: SPENDER,
    value: 5_000_000n,
    nonce: 0n,
    deadline: 1_800_000_000n,
  };
}

describe("buildUsdcPermitTypedData", () => {
  it("builds the EIP-712 domain, Permit type, and message", () => {
    const td = buildUsdcPermitTypedData(baseInput());
    expect(td.primaryType).toBe("Permit");
    expect(td.types).toBe(USDC_PERMIT_TYPES);
    expect(td.domain).toEqual({
      name: "USDC",
      version: USDC_PERMIT_VERSION,
      chainId: 84532,
      verifyingContract: TOKEN,
    });
    expect(td.message).toEqual({
      owner: account.address,
      spender: SPENDER,
      value: 5_000_000n,
      nonce: 0n,
      deadline: 1_800_000_000n,
    });
  });

  it("honours an explicit domain version override", () => {
    const td = buildUsdcPermitTypedData({ ...baseInput(), version: "1" });
    expect(td.domain.version).toBe("1");
  });
});

describe("splitPermitSignature", () => {
  it("splits a real EIP-712 signature into (v, r, s) that reconstruct it", async () => {
    const td = buildUsdcPermitTypedData(baseInput());
    const signature = await account.signTypedData(td);

    const { v, r, s } = splitPermitSignature(signature);
    expect(v === 27 || v === 28).toBe(true);
    // The parts serialize back to the exact original signature.
    expect(serializeSignature({ r, s, v: BigInt(v) })).toBe(signature);

    // …and the signature verifies against the signer for this typed data.
    const valid = await verifyTypedData({
      address: account.address,
      domain: td.domain,
      types: td.types,
      primaryType: td.primaryType,
      message: td.message,
      signature,
    });
    expect(valid).toBe(true);
  });
});
