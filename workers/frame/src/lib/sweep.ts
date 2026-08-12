// SPDX-License-Identifier: MIT
// Prune abandoned `pending_payment` drafts (Session 14, ADR-0032). The frame mints a draft BEFORE the
// paying `askQuestion` tx (chain-first). A user who approves then never confirms leaves a draft that no
// on-chain event will ever match. This age-based sweep deletes those — and ONLY those:
//
//   status = 'pending_payment'  AND  onchain_id IS NULL  AND  created_at < cutoff
//
// The `onchain_id IS NULL` + `status = 'pending_payment'` guard means the sweep NEVER touches a row the
// indexer has advanced (money-state is chain truth — ADR-0024): once a `QuestionAsked` is indexed the
// row carries an onchain_id and has moved to `open`, so it falls outside the predicate. The guard is
// re-applied in the DELETE itself, so a row that gets paid between the SELECT and the DELETE is spared.

import { questions } from "@buyananswer/shared";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import type { Db } from "../db.js";

export interface SweepResult {
  /** How many drafts were actually deleted. */
  deleted: number;
  /** The ids deleted (for the audit line). */
  ids: string[];
}

/**
 * Delete abandoned pending_payment drafts older than `olderThanSeconds`. `now` + `limit` are injectable
 * for deterministic tests; `limit` bounds how many are pruned per run so a backlog drains across ticks.
 */
export async function sweepOrphanedPendingPayments(
  db: Db,
  params: { olderThanSeconds: number; now?: Date; limit?: number },
): Promise<SweepResult> {
  const now = params.now ?? new Date();
  const cutoff = new Date(now.getTime() - params.olderThanSeconds * 1000);
  const limit = params.limit ?? 500;

  const orphaned = and(
    eq(questions.status, "pending_payment"),
    isNull(questions.onchainId),
    lt(questions.createdAt, cutoff),
  );

  // Pick a bounded batch of candidates, then delete under the SAME guard (re-checked per row) so a draft
  // paid in the meantime is left for the indexer.
  const candidates = await db
    .select({ id: questions.id })
    .from(questions)
    .where(orphaned)
    .limit(limit)
    .all();
  if (candidates.length === 0) return { deleted: 0, ids: [] };

  const candidateIds = candidates.map((c) => c.id);
  const deleted = await db
    .delete(questions)
    .where(and(inArray(questions.id, candidateIds), orphaned))
    .returning({ id: questions.id })
    .all();

  return { deleted: deleted.length, ids: deleted.map((d) => d.id) };
}
