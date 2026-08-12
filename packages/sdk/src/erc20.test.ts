// SPDX-License-Identifier: MIT
import { decodeFunctionData, toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import { encodeApprove, usdcAbi } from "./erc20.js";

// Checksummed — viem decodes addresses to their checksummed form.
const SPENDER = "0x40A4bfEc9441752BcABBd4b3939503671c8724dB" as const;

describe("encodeApprove", () => {
  it("produces the approve selector and round-trips through the ABI", () => {
    const data = encodeApprove(SPENDER, 5_000_000n);
    expect(data.startsWith(toFunctionSelector("approve(address,uint256)"))).toBe(true);

    const decoded = decodeFunctionData({ abi: usdcAbi, data });
    expect(decoded.functionName).toBe("approve");
    expect(decoded.args).toEqual([SPENDER, 5_000_000n]);
  });
});

describe("usdcAbi", () => {
  it("carries the EIP-2612 permit reads the money path needs", () => {
    const fns = usdcAbi.filter((e) => e.type === "function").map((e) => e.name);
    for (const fn of ["name", "version", "nonces", "balanceOf", "allowance", "approve"]) {
      expect(fns).toContain(fn);
    }
  });
});
