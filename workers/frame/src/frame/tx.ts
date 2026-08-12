// SPDX-License-Identifier: MIT
// Build the transaction-frame response — the JSON a Farcaster client turns into a wallet `eth_send-
// Transaction` on Base. Calldata comes ENTIRELY from @buyananswer/sdk (the shared tx layer the web app
// uses), so the frame and the web ask flow encode `askQuestion` / `approve` identically. The chain is
// pinned to Base via the CAIP-2 chain id from `@buyananswer/shared` — never a literal (golden rule).

import {
  buyAnAnswerEscrowAbi,
  encodeApprove,
  encodeAskQuestion,
  refForQuestion,
  usdcAbi,
} from "@buyananswer/sdk";
import type { Address } from "@buyananswer/shared";
import type { FrameConfig } from "../env.js";

/** The transaction-frame response body (Farcaster tx spec). `value` is wei as a string ("0" = no ETH). */
export interface FrameTxResponse {
  chainId: `eip155:${number}`;
  method: "eth_sendTransaction";
  params: {
    abi: readonly unknown[];
    to: Address;
    data: `0x${string}`;
    value: string;
  };
}

/**
 * Step 1 of 2 — `approve(escrow, amount)` on USDC. The escrow pulls the asker's USDC when the question
 * is asked, so the connected wallet must approve it first. We approve exactly `amount` (the creator's
 * price), not an unlimited allowance. Reused unconditionally (no allowance pre-read) to keep the frame
 * RPC-free; a wallet that already has allowance simply confirms a redundant approve (ADR-0031).
 */
export function buildApproveTx(config: FrameConfig, amount: bigint): FrameTxResponse {
  return {
    chainId: config.caip2,
    method: "eth_sendTransaction",
    params: {
      abi: usdcAbi,
      to: config.usdc,
      data: encodeApprove(config.escrow, amount),
      value: "0",
    },
  };
}

/**
 * Step 2 of 2 — `askQuestion(ref, answerer, amount)` on the escrow. `ref` is the minted question UUID
 * encoded to `bytes32` (the on-chain ↔ off-chain link); the indexer flips the row to `open` when it
 * sees the resulting `QuestionAsked`. The frame never asserts payment itself.
 */
export function buildAskTx(
  config: FrameConfig,
  params: { questionId: string; answerer: Address; amount: bigint },
): FrameTxResponse {
  return {
    chainId: config.caip2,
    method: "eth_sendTransaction",
    params: {
      abi: buyAnAnswerEscrowAbi,
      to: config.escrow,
      data: encodeAskQuestion({
        ref: refForQuestion(params.questionId),
        answerer: params.answerer,
        amount: params.amount,
      }),
      value: "0",
    },
  };
}
