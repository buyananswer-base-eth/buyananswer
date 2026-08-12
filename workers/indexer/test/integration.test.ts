// SPDX-License-Identifier: MIT
// Session 15 — the contract ↔ indexer ↔ UI integration seam, automated.
//
// Sessions 11–13 could only verify this seam by hand ("manual owner step"): make a real on-chain call,
// watch the indexer reconcile it, then check the UI/API reflects the money-state. This test automates
// the DETERMINISTIC half of that seam — a mocked chain feeds real escrow events through the real
// `reconcile()` into a real Miniflare D1, and we assert the exact money-state columns the API surface
// (workers/api `presentQuestion` / the answer paywall, Session 7) and the web status presenter
// (apps/web `status.ts`, Session 12) read. The on-chain half (a genuine Base Sepolia tx) is the gated
// out-of-tree Playwright journey; this is its always-green, no-funds counterpart.
//
// Because the indexer is the SOLE writer of money-state (ADR-0024), proving reconcile writes the right
// D1 state is equivalent to proving the UI reflects it — the UI/API only ever READ these columns.

import { describe, expect, it } from "vitest";
import { reconcile } from "../src/reconcile.js";
import {
  ANSWERER,
  ASKER,
  FIXED_NOW,
  FakeChainReader,
  askedEvent,
  db,
  fixedClock,
  getAnswer,
  getQuestion,
  seedAnswer,
  seedCreator,
  seedQuestion,
  settledEvent,
  testConfig,
} from "./helpers.js";

const secs = (d: Date | null | undefined) => (d ? Math.floor(d.getTime() / 1000) : null);

/** The escrow terms carried by a real `QuestionAsked` event (base-unit USDC, unix-seconds deadline). */
const ONCHAIN_ID = 42n;
const AMOUNT = 7_500_000n; // 7.5 USDC (6-dp)
const DEADLINE = 1_760_000_000n;

describe("integration: contract → indexer → UI money-state", () => {
  it("ask → answer: the reveal the UI paywall keys on is written by the indexer, not the API", async () => {
    // 1. The off-chain draft the API minted (Session 7): pending_payment, no money-state, hidden answer.
    await seedCreator(ANSWERER, "alice");
    const id = await seedQuestion({ asker: ASKER, answerer: ANSWERER });
    await seedAnswer(id, "because rayleigh scattering"); // answerer saved a hidden draft (revealed_at null)

    const pre = await getQuestion(id);
    expect(pre?.status).toBe("pending_payment");
    expect(pre?.onchainId).toBeNull();
    expect(pre?.amountUsdc).toBeNull();
    expect((await getAnswer(id))?.revealedAt).toBeNull(); // paywall closed

    const config = testConfig();

    // 2. The asker pays on-chain → QuestionAsked. The indexer reconciles it into `open`, writing the
    //    escrow terms the API deliberately never persisted (onchain_id / amount / deadline).
    await reconcile(
      db(),
      new FakeChainReader(10n, [
        askedEvent(id, {
          blockNumber: 3n,
          onchainId: ONCHAIN_ID,
          amount: AMOUNT,
          deadline: DEADLINE,
        }),
      ]),
      config,
      fixedClock,
    );

    const opened = await getQuestion(id);
    expect(opened?.status).toBe("open"); // UI: "held onchain / awaiting answer"
    expect(opened?.onchainId).toBe(ONCHAIN_ID.toString());
    expect(opened?.amountUsdc).toBe(AMOUNT.toString());
    expect(secs(opened?.answerDeadline)).toBe(Number(DEADLINE));
    expect((await getAnswer(id))?.revealedAt).toBeNull(); // still closed — not answered yet

    // 3. The answerer settles on-chain → QuestionAnswered. The indexer flips `answered` AND stamps
    //    revealed_at — the single signal the API paywall (canSeeAnswerBody) + the UI open on.
    await reconcile(
      db(),
      new FakeChainReader(20n, [settledEvent("QuestionAnswered", id, { blockNumber: 12n })]),
      config,
      fixedClock,
    );

    const answered = await getQuestion(id);
    expect(answered?.status).toBe("answered");
    expect(answered?.onchainId).toBe(ONCHAIN_ID.toString()); // terms unchanged by the settle
    expect(secs((await getAnswer(id))?.revealedAt)).toBe(secs(FIXED_NOW)); // paywall OPEN
  });

  it("ask → decline: the refund state the UI shows is the indexer's terminal write", async () => {
    await seedCreator(ANSWERER, "bob");
    const id = await seedQuestion({ answerer: ANSWERER });
    const config = testConfig();

    await reconcile(
      db(),
      new FakeChainReader(10n, [askedEvent(id, { blockNumber: 3n })]),
      config,
      fixedClock,
    );
    expect((await getQuestion(id))?.status).toBe("open");

    await reconcile(
      db(),
      new FakeChainReader(20n, [settledEvent("QuestionDeclined", id, { blockNumber: 12n })]),
      config,
      fixedClock,
    );
    expect((await getQuestion(id))?.status).toBe("declined"); // UI: "declined — refunded"
  });

  it("ask → cancel / reclaim: both asker-side refund terminals reconcile correctly", async () => {
    await seedCreator(ANSWERER, "carol");

    // Each case gets its own synthetic contract → its own cursor (so reused block numbers don't fall
    // below a cursor another case advanced) and a distinct on-chain id (the schema's
    // UNIQUE(chain_id, onchain_id) forbids reusing one).
    const cases = [
      ["QuestionCancelled", "cancelled", "0x00000000000000000000000000000000000000b1", 101n],
      ["QuestionReclaimed", "reclaimed", "0x00000000000000000000000000000000000000b2", 102n],
    ] as const;

    for (const [event, terminal, contractAddress, onchainId] of cases) {
      const config = testConfig({ contractAddress });
      const id = await seedQuestion({ answerer: ANSWERER });
      await reconcile(
        db(),
        new FakeChainReader(10n, [askedEvent(id, { blockNumber: 3n, onchainId })]),
        config,
        fixedClock,
      );
      await reconcile(
        db(),
        new FakeChainReader(20n, [settledEvent(event, id, { blockNumber: 12n })]),
        config,
        fixedClock,
      );
      expect((await getQuestion(id))?.status).toBe(terminal);
    }
  });
});
