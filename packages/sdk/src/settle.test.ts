// SPDX-License-Identifier: MIT
import { buyAnAnswerEscrowAbi } from "@buyananswer/shared";
import { decodeFunctionData, toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import {
  answerQuestionArgs,
  cancelQuestionArgs,
  declineQuestionArgs,
  encodeAnswerQuestion,
  encodeCancelQuestion,
  encodeDeclineQuestion,
  encodeReclaimQuestion,
  encodeSettle,
  encodeWithdraw,
  reclaimQuestionArgs,
  settleArgs,
  withdrawArgs,
} from "./settle.js";

const ID = 42n;

describe("settle arg tuples", () => {
  it("wrap the on-chain id as a single-element tuple", () => {
    expect(settleArgs(ID)).toEqual([ID]);
    expect(answerQuestionArgs(ID)).toEqual([ID]);
    expect(declineQuestionArgs(ID)).toEqual([ID]);
    expect(cancelQuestionArgs(ID)).toEqual([ID]);
    expect(reclaimQuestionArgs(ID)).toEqual([ID]);
  });

  it("preserves a large uint256 id without precision loss (bigint)", () => {
    const big = 2n ** 200n + 7n;
    expect(settleArgs(big)).toEqual([big]);
  });
});

describe.each([
  ["answerQuestion", encodeAnswerQuestion] as const,
  ["declineQuestion", encodeDeclineQuestion] as const,
  ["cancelQuestion", encodeCancelQuestion] as const,
  ["reclaimQuestion", encodeReclaimQuestion] as const,
])("encode %s", (fn, encode) => {
  it("produces the right selector and round-trips through the ABI", () => {
    const data = encode(ID);
    expect(data.startsWith(toFunctionSelector(`${fn}(uint256)`))).toBe(true);

    const decoded = decodeFunctionData({ abi: buyAnAnswerEscrowAbi, data });
    expect(decoded.functionName).toBe(fn);
    expect(decoded.args).toEqual([ID]);
  });

  it("matches encodeSettle for the same function", () => {
    expect(encode(ID)).toBe(encodeSettle(fn, ID));
  });
});

describe("withdraw", () => {
  it("takes no args", () => {
    expect(withdrawArgs()).toEqual([]);
  });

  it("encodes the no-arg withdraw() selector and round-trips", () => {
    const data = encodeWithdraw();
    expect(data).toBe(toFunctionSelector("withdraw()"));

    const decoded = decodeFunctionData({ abi: buyAnAnswerEscrowAbi, data });
    expect(decoded.functionName).toBe("withdraw");
    // A no-arg call decodes to `undefined` args (viem), which we accept.
    expect(decoded.args ?? []).toEqual([]);
  });
});
