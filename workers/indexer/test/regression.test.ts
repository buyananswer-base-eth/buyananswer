// SPDX-License-Identifier: MIT
// Session 15 — named regressions for the two historically risky indexer invariants:
//
//   • double-settle    — the guarded compare-and-set means a question reaches EXACTLY ONE terminal
//                         state. A duplicate settle event, a re-run of the cron, or two reconcile
//                         passes racing the SAME open question all resolve to one terminal write; a
//                         terminal state never regresses to a different terminal state.
//   • chain-first      — money-state only ever ADVANCES a row the API already minted. A chain event
//                         (QuestionAsked or a settle) whose `ref` matches no off-chain row is logged +
//                         skipped and NEVER fabricates a row — the off-chain draft is always first.
//
// These lock in ADR-0024 / FUNCTIONAL_SPEC §6 against a real Miniflare D1 with a mocked chain (no RPC).
// The corresponding on-chain proof is a gated Playwright journey, maintained out of tree.

import { questions } from "@buyananswer/shared";
import { describe, expect, it } from "vitest";
import { reconcile } from "../src/reconcile.js";
import {
  ANSWERER,
  FakeChainReader,
  askedEvent,
  db,
  fixedClock,
  getQuestion,
  resetCursor,
  seedCreator,
  seedQuestion,
  settledEvent,
  testConfig,
  unknownRefAsked,
} from "./helpers.js";

const TERMINAL = ["answered", "declined", "cancelled", "reclaimed"] as const;

/** Total question rows in D1 — proves chain-first: the indexer never CREATES a question, only advances. */
async function countQuestions(): Promise<number> {
  return (await db().select({ id: questions.id }).from(questions).all()).length;
}

/** Seed a creator + a pending_payment question, then drive it to `open` (cursor advances past the ask). */
async function seedOpen(): Promise<{ id: string; config: ReturnType<typeof testConfig> }> {
  await seedCreator(ANSWERER, "alice");
  const id = await seedQuestion();
  const config = testConfig();
  await reconcile(
    db(),
    new FakeChainReader(10n, [askedEvent(id, { blockNumber: 2n })]),
    config,
    fixedClock,
  );
  expect((await getQuestion(id))?.status).toBe("open");
  return { id, config };
}

describe("regression: double-settle (one terminal state)", () => {
  it("the same settle re-scanned after a crash (cursor reset) fires exactly once", async () => {
    await seedCreator(ANSWERER, "alice");
    const id = await seedQuestion();
    const config = testConfig();
    // head 10 → finalized 5; ask@2 and answer@5 both finalize in one pass.
    const events = [
      askedEvent(id, { blockNumber: 2n }),
      settledEvent("QuestionAnswered", id, { blockNumber: 5n }),
    ];

    const first = await reconcile(db(), new FakeChainReader(10n, events), config, fixedClock);
    expect(first.transitionsApplied).toBe(2); // ask → open, then open → answered
    expect((await getQuestion(id))?.status).toBe("answered");

    // Crash before the cursor advanced → the same range (and the same settle log) is re-scanned.
    await resetCursor(config);
    const replay = await reconcile(db(), new FakeChainReader(10n, events), config, fixedClock);
    expect(replay.eventsSeen).toBe(2); // both logs re-seen…
    expect(replay.transitionsApplied).toBe(0); // …but the settle does NOT fire a second time
    expect((await getQuestion(id))?.status).toBe("answered");
  });

  it("two DIFFERENT settle events for one open question land exactly one terminal state", async () => {
    await seedCreator(ANSWERER, "alice");
    const id = await seedQuestion();
    const config = testConfig();

    // Ask + a conflicting Answered/Declined all in one finalized batch (head 10 → finalized 5). The
    // first settle applied wins; the CAS guard (WHERE status='open') makes the second a no-op.
    const reader = new FakeChainReader(10n, [
      askedEvent(id, { blockNumber: 2n }),
      settledEvent("QuestionAnswered", id, { blockNumber: 4n }),
      settledEvent("QuestionDeclined", id, { blockNumber: 5n }),
    ]);
    const result = await reconcile(db(), reader, config, fixedClock);

    expect(result.eventsSeen).toBe(3); // all three logs seen…
    expect(result.transitionsApplied).toBe(2); // …ask→open + exactly ONE settle
    expect((await getQuestion(id))?.status).toBe("answered"); // block 4 sorts before block 5
  });

  it("two concurrent reconcile passes racing the same open question resolve to one terminal state", async () => {
    const { id, config } = await seedOpen(); // cursor now sits at the finalized head (10)

    // Two passes start from the same cursor and each carries a competing terminal event at block 12
    // (finalized head 20, so both passes scan it). D1 runs each CAS atomically, so exactly one flips
    // open→terminal and the other's UPDATE matches 0 rows — no matter how the awaits interleave.
    const [answered, declined] = await Promise.all([
      reconcile(
        db(),
        new FakeChainReader(20n, [settledEvent("QuestionAnswered", id, { blockNumber: 12n })]),
        config,
        fixedClock,
      ),
      reconcile(
        db(),
        new FakeChainReader(20n, [settledEvent("QuestionDeclined", id, { blockNumber: 12n })]),
        config,
        fixedClock,
      ),
    ]);

    // Precisely one pass applied the settle; the other saw it already gone from `open`.
    expect(answered.transitionsApplied + declined.transitionsApplied).toBe(1);

    const status = (await getQuestion(id))?.status;
    expect(TERMINAL).toContain(status);
    // The final state matches whichever pass won its CAS (the winner is a race; "one settle" is not).
    expect(status).toBe(answered.transitionsApplied === 1 ? "answered" : "declined");
  });

  it("a terminal state never regresses to a DIFFERENT terminal state", async () => {
    const { id, config } = await seedOpen(); // cursor at 10
    await reconcile(
      db(),
      new FakeChainReader(20n, [settledEvent("QuestionDeclined", id, { blockNumber: 12n })]),
      config,
      fixedClock,
    );
    expect((await getQuestion(id))?.status).toBe("declined");

    // A stray later Answered for the same ref must not overwrite the settled (refunded) state.
    const late = await reconcile(
      db(),
      new FakeChainReader(40n, [settledEvent("QuestionAnswered", id, { blockNumber: 25n })]),
      config,
      fixedClock,
    );
    expect(late.transitionsApplied).toBe(0);
    expect((await getQuestion(id))?.status).toBe("declined");
  });
});

describe("regression: chain-first ordering (money-state only advances an existing row)", () => {
  it("a QuestionAsked whose ref matches no off-chain row invents no money-state", async () => {
    await seedCreator(ANSWERER, "alice");
    const before = await countQuestions();
    const config = testConfig();

    const result = await reconcile(
      db(),
      new FakeChainReader(10n, [unknownRefAsked({ blockNumber: 1n, onchainId: 99n })]),
      config,
      fixedClock,
    );

    expect(result.eventsSeen).toBe(1);
    expect(result.transitionsApplied).toBe(0);
    expect(await countQuestions()).toBe(before); // no row conjured from a bare chain event
  });

  it("a settle for a ref that was never minted is skipped and creates nothing", async () => {
    await seedCreator(ANSWERER, "alice");
    const before = await countQuestions();
    const config = testConfig();

    const result = await reconcile(
      db(),
      new FakeChainReader(10n, [
        settledEvent("QuestionAnswered", crypto.randomUUID(), { blockNumber: 3n }),
      ]),
      config,
      fixedClock,
    );

    expect(result.transitionsApplied).toBe(0);
    expect(await countQuestions()).toBe(before);
  });

  it("in a mixed batch the unminted ref is skipped while the minted ref advances to open", async () => {
    await seedCreator(ANSWERER, "alice");
    const id = await seedQuestion();
    const before = await countQuestions();
    const config = testConfig();

    const result = await reconcile(
      db(),
      new FakeChainReader(10n, [
        unknownRefAsked({ blockNumber: 1n, onchainId: 99n }),
        askedEvent(id, { blockNumber: 2n }),
      ]),
      config,
      fixedClock,
    );

    expect(result.eventsSeen).toBe(2);
    expect(result.transitionsApplied).toBe(1); // only the row the API already minted
    expect(await countQuestions()).toBe(before); // the unknown ref added nothing
    expect((await getQuestion(id))?.status).toBe("open");
  });
});
