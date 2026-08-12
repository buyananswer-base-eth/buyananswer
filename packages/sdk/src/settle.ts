// SPDX-License-Identifier: MIT
// Build the on-chain *settle* + *withdraw* calls for the BuyAnAnswerEscrow — the second half of the
// question lifecycle (Session 12), mirroring escrow.ts (the ask half). Every settle call takes the
// on-chain question id (a `uint256`, NOT the UUID `ref`): the id the contract minted on `askQuestion`
// and the indexer wrote back to `questions.onchain_id`. `withdraw()` takes no args (it pays out the
// caller's whole pull-payment credit). Like escrow.ts this layer only *builds* args/calldata — the
// caller's client signs and sends. Amounts/ids are always `bigint`, never a JS number.

import { buyAnAnswerEscrowAbi } from "@buyananswer/shared";
import { type Hex, encodeFunctionData } from "viem";

// `buyAnAnswerEscrowAbi` is already re-exported from ./escrow.js (the SDK barrel exposes it once).

/** The four settle functions, each `settle(uint256 id)`. Every guard lives on-chain (status/caller). */
export type SettleFunction =
  | "answerQuestion"
  | "declineQuestion"
  | "cancelQuestion"
  | "reclaimQuestion";

/** Args tuple for any `settle(uint256 id)` call — the on-chain question id (`questions.onchain_id`). */
export function settleArgs(onchainId: bigint): readonly [bigint] {
  return [onchainId];
}

/** Args tuple for `answerQuestion(id)` — creator settles Open→Answered (paid, fee taken). */
export function answerQuestionArgs(onchainId: bigint): readonly [bigint] {
  return settleArgs(onchainId);
}

/** Args tuple for `declineQuestion(id)` — creator settles Open→Declined (asker refunded 100%). */
export function declineQuestionArgs(onchainId: bigint): readonly [bigint] {
  return settleArgs(onchainId);
}

/** Args tuple for `cancelQuestion(id)` — asker settles Open→Cancelled before the deadline (−cancel fee). */
export function cancelQuestionArgs(onchainId: bigint): readonly [bigint] {
  return settleArgs(onchainId);
}

/** Args tuple for `reclaimQuestion(id)` — anyone settles Open→Reclaimed after the deadline (asker 100%). */
export function reclaimQuestionArgs(onchainId: bigint): readonly [bigint] {
  return settleArgs(onchainId);
}

/** Raw calldata for a settle call, keyed by function name. */
export function encodeSettle(fn: SettleFunction, onchainId: bigint): Hex {
  return encodeFunctionData({
    abi: buyAnAnswerEscrowAbi,
    functionName: fn,
    args: settleArgs(onchainId),
  });
}

/** Raw calldata for `answerQuestion(id)`. */
export function encodeAnswerQuestion(onchainId: bigint): Hex {
  return encodeSettle("answerQuestion", onchainId);
}

/** Raw calldata for `declineQuestion(id)`. */
export function encodeDeclineQuestion(onchainId: bigint): Hex {
  return encodeSettle("declineQuestion", onchainId);
}

/** Raw calldata for `cancelQuestion(id)`. */
export function encodeCancelQuestion(onchainId: bigint): Hex {
  return encodeSettle("cancelQuestion", onchainId);
}

/** Raw calldata for `reclaimQuestion(id)`. */
export function encodeReclaimQuestion(onchainId: bigint): Hex {
  return encodeSettle("reclaimQuestion", onchainId);
}

/**
 * Args tuple for `withdraw()` — pull-payment: sweeps the caller's entire `withdrawable[account]` credit
 * to their wallet. Settling (answer/decline/cancel/reclaim) only *credits* this balance; funds leave the
 * escrow only via `withdraw()`. Takes no arguments.
 */
export function withdrawArgs(): readonly [] {
  return [];
}

/** Raw calldata for `withdraw()`. */
export function encodeWithdraw(): Hex {
  return encodeFunctionData({
    abi: buyAnAnswerEscrowAbi,
    functionName: "withdraw",
    args: withdrawArgs(),
  });
}
