// SPDX-License-Identifier: MIT
// Orphan `pending_payment` sweep (ADR-0032) — moved here from workers/frame in Session 21 when the
// v1 frame Worker was deleted in favour of a Farcaster Mini App (ADR-0042). The sweep was never
// frame-specific: the WEB app also mints a draft before the paying tx (chain-first, ADR-0027), so an
// asker who approves and then abandons leaves a row no on-chain event will ever match. The indexer
// is the right home — it already owns the money-state lifecycle and runs on a cron.
//
// The guard is the whole point and must not regress:
//   status = 'pending_payment' AND onchain_id IS NULL AND created_at < cutoff
// Once the indexer has seen `QuestionAsked` the row carries an `onchain_id` and has moved to `open`,
// so it falls outside the predicate. The guard is RE-APPLIED inside the DELETE, so a draft that gets
// paid between the SELECT and the DELETE is spared — the sweep can never delete paid-for work.

import { questions } from "@buyananswer/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { sweepOrphanedPendingPayments } from "../src/lib/sweep.js";
import { ANSWERER, ASKER, db, seedCreator } from "./helpers.js";

const NOW = new Date("2026-08-11T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000);
const DAY = 24 * 3600;

// `questions.answerer_wallet` is a FK onto `creators` — a draft cannot exist without one.
beforeEach(async () => {
  await seedCreator(ANSWERER, "satoshi");
});

async function seedDraft(over: {
  id: string;
  status?: string;
  onchainId?: string | null;
  createdAt: Date;
}) {
  await db()
    .insert(questions)
    .values({
      id: over.id,
      chainId: 8453,
      askerWallet: ASKER,
      answererWallet: ANSWERER,
      body: "why is the sky blue?",
      status: (over.status ?? "pending_payment") as "pending_payment",
      onchainId: over.onchainId ?? null,
      createdAt: over.createdAt,
    });
}

const allIds = async () =>
  (await db().select({ id: questions.id }).from(questions).all()).map((q) => q.id).sort();

describe("orphan pending_payment sweep (ADR-0032, now indexer-owned)", () => {
  it("deletes only aged, unpaid, still-pending drafts", async () => {
    await seedDraft({ id: "aaaaaaaa-0000-4000-8000-000000000001", createdAt: hoursAgo(48) }); // swept
    await seedDraft({ id: "bbbbbbbb-0000-4000-8000-000000000002", createdAt: hoursAgo(1) }); // too new
    await seedDraft({
      id: "cccccccc-0000-4000-8000-000000000003",
      status: "open",
      onchainId: "5",
      createdAt: hoursAgo(48),
    }); // indexer-advanced — never touched

    const result = await sweepOrphanedPendingPayments(db(), {
      olderThanSeconds: DAY,
      now: NOW,
    });

    expect(result.deleted).toBe(1);
    expect(result.ids).toEqual(["aaaaaaaa-0000-4000-8000-000000000001"]);
    expect(await allIds()).toEqual([
      "bbbbbbbb-0000-4000-8000-000000000002",
      "cccccccc-0000-4000-8000-000000000003",
    ]);
  });

  it("NEVER deletes a row the indexer has advanced, however old", async () => {
    // The money-safety property. A settled question is chain truth (ADR-0024); a sweep that removed
    // one would destroy the off-chain record of real, paid-for work.
    for (const [i, status] of [
      "open",
      "answered",
      "declined",
      "cancelled",
      "reclaimed",
    ].entries()) {
      await seedDraft({
        id: `eeeeeeee-0000-4000-8000-00000000000${i}`,
        status,
        onchainId: String(100 + i),
        createdAt: hoursAgo(24 * 365),
      });
    }
    const result = await sweepOrphanedPendingPayments(db(), { olderThanSeconds: DAY, now: NOW });
    expect(result.deleted).toBe(0);
    expect(await allIds()).toHaveLength(5);
  });

  it("spares a pending_payment row that already carries an onchain_id", async () => {
    // Belt-and-braces: status could lag the id write; the id alone proves the chain has seen it.
    await seedDraft({
      id: "ffffffff-0000-4000-8000-000000000001",
      onchainId: "42",
      createdAt: hoursAgo(48),
    });
    const result = await sweepOrphanedPendingPayments(db(), { olderThanSeconds: DAY, now: NOW });
    expect(result.deleted).toBe(0);
  });

  it("is a no-op when nothing is old enough", async () => {
    await seedDraft({ id: "dddddddd-0000-4000-8000-000000000004", createdAt: hoursAgo(2) });
    const result = await sweepOrphanedPendingPayments(db(), { olderThanSeconds: DAY, now: NOW });
    expect(result.deleted).toBe(0);
    expect(await allIds()).toHaveLength(1);
  });

  it("bounds a backlog per run so it drains across ticks instead of timing out", async () => {
    for (let i = 0; i < 5; i++) {
      await seedDraft({
        id: `11111111-0000-4000-8000-00000000000${i}`,
        createdAt: hoursAgo(48),
      });
    }
    const first = await sweepOrphanedPendingPayments(db(), {
      olderThanSeconds: DAY,
      now: NOW,
      limit: 2,
    });
    expect(first.deleted).toBe(2);
    expect(await allIds()).toHaveLength(3);
  });
});
