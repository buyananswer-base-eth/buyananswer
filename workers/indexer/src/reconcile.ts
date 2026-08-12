// SPDX-License-Identifier: MIT
// The reconcile core — the sole writer of money-state. It reads confirmed escrow events from a
// ChainReader and folds them into D1 idempotently, then advances the per-(chain, contract) cursor.
//
// IDEMPOTENCY (never double-credit, never regress a terminal state): every money-state write is a
// guarded compare-and-set — an UPDATE whose WHERE clause includes the REQUIRED prior status. Replaying
// the same log, or applying logs out of order, simply changes 0 rows. There is no separate
// processed-logs table (that would be a schema change); the transition guard + the block cursor are
// the whole idempotency mechanism. (ADR-0024, FUNCTIONAL_SPEC §6/§11.)
//
// CRASH-SAFETY: writes aren't wrapped in a transaction — every write is a CAS, so re-scanning a chunk
// after a crash re-applies nothing. The cursor only advances after a chunk's events are applied, and it
// is monotonic (never moves backward), so downtime is caught up on the next run.

import { answers, indexerCursor, questions, tryRefToUuid } from "@buyananswer/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { ChainReader } from "./chain.js";
import type { Db } from "./db.js";
import type { IndexerConfig } from "./env.js";
import { type EscrowEvent, byBlockThenLog, statusForEvent } from "./events.js";
import { type AuditBase, auditMoneyState, log } from "./log.js";

/** Injectable clock so tests are deterministic (defaults to wall-clock). */
export type Clock = () => Date;

/** What one reconcile pass did — returned by `POST /reconcile` and logged after every run. */
export interface ReconcileResult {
  chainId: number;
  contractAddress: string;
  /** First block this pass scanned (cursor + 1). */
  fromBlock: number;
  /** New cursor position after this pass (unchanged if nothing to scan). */
  toBlock: number;
  /** The finalized head (chain head − confirmations) at the start of the pass. */
  head: number;
  /** Blocks advanced this pass. */
  scanned: number;
  /** Escrow events seen (across all chunks). */
  eventsSeen: number;
  /** Money-state transitions actually applied (idempotent no-ops don't count). */
  transitionsApplied: number;
}

const bigMin = (a: bigint, b: bigint): bigint => (a < b ? a : b);

/** Read the cursor's last processed block, or the deployment's start block if no cursor row exists. */
async function loadCursorBlock(db: Db, config: IndexerConfig): Promise<number> {
  const row = await db
    .select({ lastBlock: indexerCursor.lastBlock })
    .from(indexerCursor)
    .where(
      and(
        eq(indexerCursor.chainId, config.chainId),
        eq(indexerCursor.contractAddress, config.contractAddress),
      ),
    )
    .get();
  return row ? row.lastBlock : config.startBlock;
}

/** Advance the cursor to `lastBlock`, monotonically (a concurrent run can never move it backward). */
async function saveCursorBlock(
  db: Db,
  config: IndexerConfig,
  lastBlock: number,
  now: Date,
): Promise<void> {
  await db
    .insert(indexerCursor)
    .values({
      chainId: config.chainId,
      contractAddress: config.contractAddress,
      lastBlock,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [indexerCursor.chainId, indexerCursor.contractAddress],
      // `indexer_cursor.last_block` refers to the existing row inside DO UPDATE — keep the max.
      set: { lastBlock: sql`max(${indexerCursor.lastBlock}, ${lastBlock})`, updatedAt: now },
    });
}

/**
 * Apply one event to D1. Returns 1 if a money-state transition fired, else 0 (unknown ref or
 * idempotent no-op). Every outcome is written to the money-state audit trail.
 */
export async function applyEvent(
  db: Db,
  config: IndexerConfig,
  ev: EscrowEvent,
  now: Date,
): Promise<0 | 1> {
  const audit = {
    eventName: ev.name,
    ref: ev.ref,
    onchainId: ev.onchainId.toString(),
    txHash: ev.txHash,
    logIndex: ev.logIndex,
    blockNumber: ev.blockNumber.toString(),
  };

  const uuid = tryRefToUuid(ev.ref);
  if (!uuid) {
    // A ref that isn't a left-padded UUID never maps to a question — log + skip, never crash.
    auditMoneyState({ ...audit, outcome: "unknown_ref" });
    return 0;
  }

  if (ev.name === "QuestionAsked") {
    // pending_payment → open, writing the escrow terms the API deliberately never persisted.
    const changed = await db
      .update(questions)
      .set({
        onchainId: ev.onchainId.toString(),
        amountUsdc: ev.amount.toString(),
        answerDeadline: new Date(Number(ev.deadline) * 1000),
        status: "open",
        updatedAt: now,
      })
      .where(
        and(
          eq(questions.id, uuid),
          eq(questions.chainId, config.chainId),
          eq(questions.status, "pending_payment"),
        ),
      )
      .returning({ id: questions.id });

    if (changed.length > 0) {
      auditMoneyState({
        ...audit,
        outcome: "applied",
        from: "pending_payment",
        to: "open",
        questionId: uuid,
      });
      return 1;
    }
    return noopOrUnknown(db, config, audit, uuid, "open");
  }

  // A settle event: open → answered | declined | cancelled | reclaimed.
  const target = statusForEvent(ev.name);
  const changed = await db
    .update(questions)
    .set({ status: target, updatedAt: now })
    .where(
      and(
        eq(questions.id, uuid),
        eq(questions.chainId, config.chainId),
        eq(questions.status, "open"),
      ),
    )
    .returning({ id: questions.id });

  if (changed.length > 0) {
    // The answered event opens the paywall: reveal the (already-hidden) answer draft, if one exists.
    if (ev.name === "QuestionAnswered") {
      await db
        .update(answers)
        .set({ revealedAt: now, updatedAt: now })
        .where(and(eq(answers.questionId, uuid), isNull(answers.revealedAt)));
    }
    auditMoneyState({ ...audit, outcome: "applied", from: "open", to: target, questionId: uuid });
    return 1;
  }
  return noopOrUnknown(db, config, audit, uuid, target);
}

/** Classify a 0-row CAS for the audit log: the ref is unknown, already at target, or not yet ready. */
async function noopOrUnknown(
  db: Db,
  config: IndexerConfig,
  audit: AuditBase,
  uuid: string,
  target: string,
): Promise<0> {
  const existing = await db
    .select({ status: questions.status })
    .from(questions)
    .where(and(eq(questions.id, uuid), eq(questions.chainId, config.chainId)))
    .get();
  if (!existing) {
    auditMoneyState({ ...audit, outcome: "unknown_ref", questionId: uuid });
    return 0;
  }
  const outcome = existing.status === target ? "noop_already" : "noop_precondition";
  auditMoneyState({ ...audit, outcome, from: existing.status, to: target, questionId: uuid });
  return 0;
}

/**
 * Run one reconcile pass: from the cursor to the confirmed head (capped at `maxBlocksPerRun`), applying
 * every escrow event in (block, logIndex) order and advancing the cursor per chunk.
 */
export async function reconcile(
  db: Db,
  reader: ChainReader,
  config: IndexerConfig,
  clock: Clock = () => new Date(),
): Promise<ReconcileResult> {
  const now = clock();
  const lastBlock = await loadCursorBlock(db, config);
  const head = await reader.getFinalizedHead();
  const from = BigInt(lastBlock) + 1n;

  const base: ReconcileResult = {
    chainId: config.chainId,
    contractAddress: config.contractAddress,
    fromBlock: lastBlock + 1,
    toBlock: lastBlock,
    head: Number(head),
    scanned: 0,
    eventsSeen: 0,
    transitionsApplied: 0,
  };

  if (from > head) {
    log.info("reconcile_noop", { chainId: config.chainId, lastBlock, head: head.toString() });
    return base;
  }

  // Cap blocks per run so a large backfill catches up across ticks within Worker CPU/subrequest limits.
  const runEnd = bigMin(head, from + BigInt(config.maxBlocksPerRun) - 1n);
  const range = BigInt(config.getLogsRange);

  let cursor = lastBlock;
  let eventsSeen = 0;
  let applied = 0;

  for (let lo = from; lo <= runEnd; lo += range) {
    const hi = bigMin(runEnd, lo + range - 1n);
    const events = (await reader.getLogs(lo, hi)).slice().sort(byBlockThenLog);
    eventsSeen += events.length;
    for (const ev of events) {
      applied += await applyEvent(db, config, ev, now);
    }
    cursor = Number(hi);
    await saveCursorBlock(db, config, cursor, now);
  }

  const result: ReconcileResult = {
    ...base,
    toBlock: cursor,
    scanned: cursor - lastBlock,
    eventsSeen,
    transitionsApplied: applied,
  };
  log.info("reconcile_done", { ...result, head: head.toString() });
  return result;
}
