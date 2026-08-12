import { buyAnAnswerEscrowAbi, uuidToRef } from "@buyananswer/shared";
// SPDX-License-Identifier: MIT
import { decodeFunctionData, toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import {
  askQuestionArgs,
  askQuestionWithPermitArgs,
  encodeAskQuestion,
  encodeAskQuestionWithPermit,
  refForQuestion,
} from "./escrow.js";

const UUID = "36b8f84d-df4e-4d49-b662-bbfa1046a2b0";
const REF = uuidToRef(UUID);
// Checksummed — viem decodes addresses to their checksummed form, so the round-trip assertions match.
const ANSWERER = "0xE0f0275d3Db47d9DcD056766b02fc7606F36cc43" as const;
const AMOUNT = 5_000_000n; // 5 USDC

describe("refForQuestion", () => {
  it("encodes the UUID as the shared left-padded bytes32 ref", () => {
    expect(refForQuestion(UUID)).toBe(REF);
    expect(REF).toBe(`0x${"0".repeat(32)}36b8f84ddf4e4d49b662bbfa1046a2b0`);
  });
});

describe("askQuestionArgs", () => {
  it("builds the (ref, answerer, amount) tuple", () => {
    expect(askQuestionArgs({ ref: REF, answerer: ANSWERER, amount: AMOUNT })).toEqual([
      REF,
      ANSWERER,
      AMOUNT,
    ]);
  });
});

describe("encodeAskQuestion", () => {
  it("produces the askQuestion selector and round-trips through the ABI", () => {
    const data = encodeAskQuestion({ ref: REF, answerer: ANSWERER, amount: AMOUNT });
    expect(data.startsWith(toFunctionSelector("askQuestion(bytes32,address,uint128)"))).toBe(true);

    const decoded = decodeFunctionData({ abi: buyAnAnswerEscrowAbi, data });
    expect(decoded.functionName).toBe("askQuestion");
    expect(decoded.args).toEqual([REF, ANSWERER, AMOUNT]);
  });
});

describe("askQuestionWithPermit", () => {
  const permit = {
    value: AMOUNT,
    deadline: 1_800_000_000n,
    v: 28,
    r: `0x${"11".repeat(32)}`,
    s: `0x${"22".repeat(32)}`,
  } as const;

  it("orders the permit args as (ref, answerer, amount, value, deadline, v, r, s)", () => {
    expect(
      askQuestionWithPermitArgs({ ref: REF, answerer: ANSWERER, amount: AMOUNT }, permit),
    ).toEqual([REF, ANSWERER, AMOUNT, permit.value, permit.deadline, permit.v, permit.r, permit.s]);
  });

  it("round-trips the calldata through the ABI", () => {
    const data = encodeAskQuestionWithPermit(
      { ref: REF, answerer: ANSWERER, amount: AMOUNT },
      permit,
    );
    const decoded = decodeFunctionData({ abi: buyAnAnswerEscrowAbi, data });
    expect(decoded.functionName).toBe("askQuestionWithPermit");
    expect(decoded.args).toEqual([
      REF,
      ANSWERER,
      AMOUNT,
      permit.value,
      permit.deadline,
      permit.v,
      permit.r,
      permit.s,
    ]);
  });
});
