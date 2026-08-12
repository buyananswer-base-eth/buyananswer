// SPDX-License-Identifier: MIT
// Read a minted question row by id — used by `tx-ask` to bind the paid `ref` to the verified asker who
// minted it (ADR-0032). The frame only ever READS here; money-state stays the indexer's alone.

import { type Address, questions } from "@buyananswer/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../db.js";

/** The subset of a question row the ask-binding check needs. */
export interface QuestionOwnership {
  id: string;
  askerWallet: Address;
  answererWallet: Address;
  status: string;
}

/** Look up a question by id (the off-chain UUID = on-chain ref). Returns `null` when absent. */
export async function getQuestionById(db: Db, id: string): Promise<QuestionOwnership | null> {
  const row = await db.select().from(questions).where(eq(questions.id, id)).get();
  if (!row) return null;
  return {
    id: row.id,
    askerWallet: row.askerWallet,
    answererWallet: row.answererWallet,
    status: row.status,
  };
}
