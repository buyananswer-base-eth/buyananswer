// SPDX-License-Identifier: MIT
// Build the on-chain `askQuestion` / `askQuestionWithPermit` calls for the BuyAnAnswerEscrow. This is
// the framework-agnostic tx layer the web ask flow (and, later, the Farcaster frame) shares: it turns a
// question's UUID + answerer + amount into either a wagmi-style args tuple or raw calldata. Money is
// always base-unit `bigint`; the question id is the UUID from `POST /questions`, encoded to `bytes32`
// via the shared codec (FUNCTIONAL_SPEC §6).

import { type Address, buyAnAnswerEscrowAbi, uuidToRef } from "@buyananswer/shared";
import { type Hex, encodeFunctionData } from "viem";
import type { PermitSignatureParts } from "./permit.js";

/** The escrow ABI (re-exported so SDK consumers don't need a separate `@buyananswer/shared` import). */
export { buyAnAnswerEscrowAbi } from "@buyananswer/shared";

/** Core ask parameters: the question ref (bytes32), the answerer (creator), and the USDC amount. */
export interface AskParams {
  /** The question UUID from `POST /questions`, encoded to a `bytes32` ref. See {@link refForQuestion}. */
  ref: Hex;
  /** The creator being asked (the board's wallet). */
  answerer: Address;
  /** USDC base units to escrow (`uint128`); must be > 0 and ≥ the creator's min price. */
  amount: bigint;
}

/** Permit inputs for the single-signature ask path (`value` ≥ `amount`). */
export interface AskPermit extends PermitSignatureParts {
  /** The permit's approved value (must be ≥ `amount`). */
  value: bigint;
  /** The permit signature's unix-seconds deadline. */
  deadline: bigint;
}

/** Encode a question's UUID (`questions.id`) as the on-chain `bytes32 ref`. */
export function refForQuestion(uuid: string): Hex {
  return uuidToRef(uuid);
}

/** Args tuple for `askQuestion(ref, answerer, amount)` — requires a prior USDC approval/permit. */
export function askQuestionArgs(p: AskParams): readonly [Hex, Address, bigint] {
  return [p.ref, p.answerer, p.amount];
}

/** Args tuple for `askQuestionWithPermit(ref, answerer, amount, value, deadline, v, r, s)`. */
export function askQuestionWithPermitArgs(
  p: AskParams,
  permit: AskPermit,
): readonly [Hex, Address, bigint, bigint, bigint, number, Hex, Hex] {
  return [p.ref, p.answerer, p.amount, permit.value, permit.deadline, permit.v, permit.r, permit.s];
}

/** Raw calldata for `askQuestion` (approve-first path). */
export function encodeAskQuestion(p: AskParams): Hex {
  return encodeFunctionData({
    abi: buyAnAnswerEscrowAbi,
    functionName: "askQuestion",
    args: askQuestionArgs(p),
  });
}

/** Raw calldata for `askQuestionWithPermit` (single-signature path). */
export function encodeAskQuestionWithPermit(p: AskParams, permit: AskPermit): Hex {
  return encodeFunctionData({
    abi: buyAnAnswerEscrowAbi,
    functionName: "askQuestionWithPermit",
    args: askQuestionWithPermitArgs(p, permit),
  });
}
