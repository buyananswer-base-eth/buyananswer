// SPDX-License-Identifier: MIT
// The indexer's core guarantees, proven against a real Miniflare D1 with a MOCKED log source (no live
// RPC). Covers: ask→answer convergence + the paywall reveal, replay-is-a-no-op (transition guards),
// cursor persist/resume after downtime, out-of-order + duplicate logs, settle-before-ask / unknown ref
// handled gracefully, the confirmation ceiling (reorg safety), and the per-run backfill cap.

import { describe, expect, it } from "vitest";
import { reconcile } from "../src/reconcile.js";
import {
  ANSWERER,
  FIXED_NOW,
  FakeChainReader,
  TEST_CONTRACT,
  askedEvent,
  db,
  fixedClock,
  getAnswer,
  getCursor,
  getQuestion,
  resetCursor,
  seedAnswer,
  seedCreator,
  seedQuestion,
  settledEvent,
  testConfig,
  unknownRefAsked,
} from "./helpers.js";

/** Seed a creator + a pending_payment question, returning the question id. */
async function seedPending(handle = "alice") {
  await seedCreator(ANSWERER, handle);
  return seedQuestion();
}

const secs = (d: Date | null | undefined) => (d ? Math.floor(d.getTime() / 1000) : null);

describe("QuestionAsked → open", () => {
  it("writes onchain_id, amount, deadline and flips status to open", async () => {
    const id = await seedPending();
    const config = testConfig();
    const reader = new FakeChainReader(10n, [
      askedEvent(id, { onchainId: 7n, amount: 5_000_000n, deadline: 1_700_000_000n }),
    ]);

    const result = await reconcile(db(), reader, config, fixedClock);

    expect(result.transitionsApplied).toBe(1);
    const q = await getQuestion(id);
    expect(q?.status).toBe("open");
    expect(q?.onchainId).toBe("7");
    expect(q?.amountUsdc).toBe("5000000");
    expect(secs(q?.answerDeadline)).toBe(1_700_000_000);
    // Cursor advanced to the finalized head.
    expect((await getCursor(config.chainId, TEST_CONTRACT))?.lastBlock).toBe(10);
  });
});

describe("ask → answer convergence + paywall reveal", () => {
  it("marks answered and reveals the hidden answer draft", async () => {
    const id = await seedPending();
    await seedAnswer(id);
    const config = testConfig();
    const reader = new FakeChainReader(10n, [
      askedEvent(id),
      settledEvent("QuestionAnswered", id, { blockNumber: 3n }),
    ]);

    await reconcile(db(), reader, config, fixedClock);

    const q = await getQuestion(id);
    expect(q?.status).toBe("answered");
    const a = await getAnswer(id);
    expect(secs(a?.revealedAt)).toBe(secs(FIXED_NOW));
  });

  it("marks answered even when no answer draft exists yet (no crash)", async () => {
    const id = await seedPending();
    const config = testConfig();
    const reader = new FakeChainReader(10n, [
      askedEvent(id),
      settledEvent("QuestionAnswered", id, { blockNumber: 3n }),
    ]);

    await reconcile(db(), reader, config, fixedClock);

    expect((await getQuestion(id))?.status).toBe("answered");
    expect(await getAnswer(id)).toBeUndefined();
  });
});

describe("decline / cancel / reclaim", () => {
  for (const [name, status] of [
    ["QuestionDeclined", "declined"],
    ["QuestionCancelled", "cancelled"],
    ["QuestionReclaimed", "reclaimed"],
  ] as const) {
    it(`${name} → ${status}`, async () => {
      const id = await seedPending();
      const config = testConfig();
      const reader = new FakeChainReader(10n, [
        askedEvent(id),
        settledEvent(name, id, { blockNumber: 4n }),
      ]);

      await reconcile(db(), reader, config, fixedClock);
      expect((await getQuestion(id))?.status).toBe(status);
    });
  }
});

describe("idempotency", () => {
  it("replaying the SAME logs over the same range is a no-op (transition guards)", async () => {
    const id = await seedPending();
    await seedAnswer(id);
    const config = testConfig();
    const events = [askedEvent(id), settledEvent("QuestionAnswered", id, { blockNumber: 3n })];

    const first = await reconcile(db(), new FakeChainReader(10n, events), config, fixedClock);
    expect(first.transitionsApplied).toBe(2);

    // Simulate a crash before the cursor advanced: drop it and re-run the same range.
    await resetCursor(config);
    const replay = await reconcile(db(), new FakeChainReader(10n, events), config, fixedClock);

    expect(replay.eventsSeen).toBe(2); // the logs are re-seen…
    expect(replay.transitionsApplied).toBe(0); // …but nothing changes.
    expect((await getQuestion(id))?.status).toBe("answered");
  });

  it("a terminal state never regresses (a stray earlier-stage event after settle is a no-op)", async () => {
    const id = await seedPending();
    const config = testConfig();
    // Declined first, then a stray Asked + Answered for the same ref arrive later.
    await reconcile(
      db(),
      new FakeChainReader(5n, [
        askedEvent(id),
        settledEvent("QuestionDeclined", id, { blockNumber: 3n }),
      ]),
      config,
      fixedClock,
    );
    expect((await getQuestion(id))?.status).toBe("declined");

    const late = await reconcile(
      db(),
      new FakeChainReader(20n, [
        askedEvent(id, { blockNumber: 11n }),
        settledEvent("QuestionAnswered", id, { blockNumber: 12n }),
      ]),
      config,
      fixedClock,
    );
    expect(late.transitionsApplied).toBe(0);
    expect((await getQuestion(id))?.status).toBe("declined");
  });

  it("duplicate logs in a single batch apply once", async () => {
    const id = await seedPending();
    const config = testConfig();
    const asked = askedEvent(id);
    const reader = new FakeChainReader(10n, [asked, { ...asked, logIndex: 1 }]);

    const result = await reconcile(db(), reader, config, fixedClock);
    expect(result.transitionsApplied).toBe(1);
    expect((await getQuestion(id))?.status).toBe("open");
  });
});

describe("ordering", () => {
  it("applies out-of-order logs correctly (settle listed before ask in the batch)", async () => {
    const id = await seedPending();
    await seedAnswer(id);
    const config = testConfig();
    // Answered appears BEFORE Asked in the array, but at a later block — sort must fix the order.
    const reader = new FakeChainReader(10n, [
      settledEvent("QuestionAnswered", id, { blockNumber: 5n }),
      askedEvent(id, { blockNumber: 2n }),
    ]);

    const result = await reconcile(db(), reader, config, fixedClock);
    expect(result.transitionsApplied).toBe(2);
    expect((await getQuestion(id))?.status).toBe("answered");
  });
});

describe("graceful skips", () => {
  it("an unknown ref does not crash the batch — a valid event alongside it still applies", async () => {
    const id = await seedPending();
    const config = testConfig();
    const reader = new FakeChainReader(10n, [
      unknownRefAsked({ blockNumber: 1n, onchainId: 99n }),
      askedEvent(id, { blockNumber: 2n }),
    ]);

    const result = await reconcile(db(), reader, config, fixedClock);
    expect(result.eventsSeen).toBe(2);
    expect(result.transitionsApplied).toBe(1); // only the known ref applied
    expect((await getQuestion(id))?.status).toBe("open");
  });

  it("a settle before its ask (still pending) is a no-op; the later ask still converges", async () => {
    const id = await seedPending();
    const config = testConfig();

    // First run: only an Answered event arrives while the row is still pending_payment.
    const early = await reconcile(
      db(),
      new FakeChainReader(5n, [settledEvent("QuestionAnswered", id, { blockNumber: 3n })]),
      config,
      fixedClock,
    );
    expect(early.transitionsApplied).toBe(0);
    expect((await getQuestion(id))?.status).toBe("pending_payment"); // uncorrupted

    // Later run: the Asked event arrives and moves it to open.
    await reconcile(
      db(),
      new FakeChainReader(15n, [askedEvent(id, { blockNumber: 10n })]),
      config,
      fixedClock,
    );
    expect((await getQuestion(id))?.status).toBe("open");
  });
});

describe("cursor persistence + resume", () => {
  it("persists the cursor and resumes from it after downtime (only new events applied)", async () => {
    const id1 = await seedPending();
    const config = testConfig();

    // First window: head 8, one ask at block 4.
    const run1 = await reconcile(
      db(),
      new FakeChainReader(8n, [askedEvent(id1, { blockNumber: 4n })]),
      config,
      fixedClock,
    );
    expect(run1.fromBlock).toBe(1);
    expect(run1.toBlock).toBe(8);
    expect((await getCursor(config.chainId, TEST_CONTRACT))?.lastBlock).toBe(8);

    // Downtime, then new activity. A second question asked at block 12.
    const id2 = await seedQuestion();
    const run2 = await reconcile(
      db(),
      new FakeChainReader(15n, [
        askedEvent(id1, { blockNumber: 4n }), // old event still returned by getLogs…
        askedEvent(id2, { blockNumber: 12n, onchainId: 2n }),
      ]),
      config,
      fixedClock,
    );
    // Resumes at 9 (not 1); the old block-4 event is below the window and never re-scanned.
    expect(run2.fromBlock).toBe(9);
    expect(run2.transitionsApplied).toBe(1);
    expect((await getQuestion(id2))?.status).toBe("open");
    expect((await getCursor(config.chainId, TEST_CONTRACT))?.lastBlock).toBe(15);
  });

  it("does nothing when the finalized head has not advanced past the cursor", async () => {
    const config = testConfig();
    await reconcile(db(), new FakeChainReader(6n, []), config, fixedClock);
    const again = await reconcile(db(), new FakeChainReader(6n, []), config, fixedClock);
    expect(again.scanned).toBe(0);
    expect(again.transitionsApplied).toBe(0);
  });
});

describe("confirmations (reorg safety)", () => {
  it("never processes past the finalized head; catches up once it advances", async () => {
    const id = await seedPending();
    const config = testConfig();
    // Ask is at block 9, but the finalized head is only 7 → not yet processed.
    const reader = new FakeChainReader(7n, [askedEvent(id, { blockNumber: 9n })]);
    const run1 = await reconcile(db(), reader, config, fixedClock);
    expect(run1.transitionsApplied).toBe(0);
    expect((await getQuestion(id))?.status).toBe("pending_payment");

    // Head advances past the ask → it finalizes.
    reader.head = 12n;
    const run2 = await reconcile(db(), reader, config, fixedClock);
    expect(run2.transitionsApplied).toBe(1);
    expect((await getQuestion(id))?.status).toBe("open");
  });
});

describe("chunking + per-run cap", () => {
  it("applies every event across multiple getLogs chunks", async () => {
    const id1 = await seedPending();
    const id2 = await seedQuestion();
    const config = testConfig({ getLogsRange: 2 });
    const reader = new FakeChainReader(6n, [
      askedEvent(id1, { blockNumber: 1n }),
      askedEvent(id2, { blockNumber: 5n, onchainId: 2n }),
    ]);

    const result = await reconcile(db(), reader, config, fixedClock);
    expect(result.transitionsApplied).toBe(2);
    // 3 chunks of 2 blocks each: [1,2],[3,4],[5,6].
    expect(reader.getLogsCalls).toEqual([
      [1n, 2n],
      [3n, 4n],
      [5n, 6n],
    ]);
  });

  it("caps blocks per run and catches up across ticks (backfill)", async () => {
    const id = await seedPending();
    const config = testConfig({ maxBlocksPerRun: 3 });
    const events = [askedEvent(id, { blockNumber: 8n })];

    // head 10, cap 3 → run 1 covers 1..3.
    let run = await reconcile(db(), new FakeChainReader(10n, events), config, fixedClock);
    expect(run.toBlock).toBe(3);
    expect((await getQuestion(id))?.status).toBe("pending_payment"); // event at 8 not reached yet

    run = await reconcile(db(), new FakeChainReader(10n, events), config, fixedClock); // 4..6
    expect(run.toBlock).toBe(6);
    run = await reconcile(db(), new FakeChainReader(10n, events), config, fixedClock); // 7..9 (event at 8)
    expect(run.toBlock).toBe(9);
    expect((await getQuestion(id))?.status).toBe("open");
  });
});

describe("migration-seeded cursor", () => {
  it("ships the Base Sepolia cursor at the deploy block", async () => {
    const seeded = await getCursor(84532, "0x40a4bfec9441752bcabbd4b3939503671c8724db");
    expect(seeded?.lastBlock).toBe(45_351_822);
  });
});
