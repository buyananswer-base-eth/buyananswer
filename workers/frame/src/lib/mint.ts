// SPDX-License-Identifier: MIT
// Mint the off-chain question draft — the chain-first first step (ADR-0027): a `pending_payment` row
// must exist BEFORE the paying `askQuestion` tx, so the indexer has a row to flip to `open` when it
// sees `QuestionAsked` (an on-chain event whose `ref` matches no row is logged + skipped). This is the
// SAME non-money-state insert the API's `POST /questions` does — the frame writes only id / chain /
// asker / answerer / body and leaves `status='pending_payment'`; NO money-state column is touched
// (that's the indexer's alone — ADR-0021, ADR-0024).
//
// The asker identity comes from the hub-VERIFIED connected wallet (verify.ts), not untrusted input.
// The min-price gate mirrors the API's ADR-0023 gate (BigInt compare); since the frame asks at exactly
// the creator's min price it always passes, but we assert it defensively so the rule lives in one voice.

import { type Address, questions, toLowerAddress } from "@buyananswer/shared";
import type { Db } from "../db.js";
import type { FrameCreator } from "./creator.js";

/** Body length bound mirrored from the API (`questions.body` CHECK is 1–2000; API zod is 1–2000). */
export const MAX_QUESTION_LEN = 2000;

export type MintResult =
  | { ok: true; id: string; amount: bigint }
  | { ok: false; reason: "empty_question" | "amount_below_min" };

/**
 * Insert a `pending_payment` question row for `creator`, asked by `asker` at the creator's min price.
 * Returns the new UUID (which the caller encodes as the on-chain `bytes32 ref`) + the amount to charge.
 */
export async function mintQuestion(
  db: Db,
  params: { creator: FrameCreator; asker: Address; body: string; chainId: number },
): Promise<MintResult> {
  const body = params.body.trim();
  if (body.length === 0) return { ok: false, reason: "empty_question" };

  const amount = BigInt(params.creator.minPriceUsdc);
  // Belt-and-suspenders: the frame charges exactly the min price, so this holds by construction.
  if (amount < BigInt(params.creator.minPriceUsdc))
    return { ok: false, reason: "amount_below_min" };

  const id = crypto.randomUUID();
  await db.insert(questions).values({
    id,
    chainId: params.chainId,
    askerWallet: toLowerAddress(params.asker),
    answererWallet: params.creator.wallet,
    body: body.slice(0, MAX_QUESTION_LEN),
    // status defaults to 'pending_payment'; is_public defaults to false. No money-state is set.
  });
  return { ok: true, id, amount };
}
