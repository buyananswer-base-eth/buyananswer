// SPDX-License-Identifier: MIT
// The tail of the harness: the RECLAIM path, which the live escrow gates behind its 7-day answer window
// and so cannot be exercised in one sitting. `harness.spec.ts` leaves one ASKER_3 → CREATOR_B question
// deliberately open and records it in `.harness/state.json`; this spec finishes it through the UI once
// the window has actually passed — the asker reclaims 100% (no fee) and withdraws.
//
// Run it on or after the recorded deadline:  pnpm run test:reclaim
// Before then (or with no recorded question) it skips cleanly, printing when it matures. Reclaim's
// contract-level behaviour is already covered by the forge unit + invariant suites; this is the UI half.

import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { loadActors } from "../harness/actors";
import { usdc, usdcBalance, withdrawable } from "../harness/chain";
import { RECONCILE_TOKEN, RPC_URL, STATE_PATH } from "../harness/env";
import { indexerReady, startReconcileNudger } from "../harness/reconcile";
import {
  type ActorSession,
  openActor,
  readQuestion,
  reclaimQuestion,
  signIn,
  withdrawAll,
} from "../harness/ui";

interface HarnessState {
  reclaim?: {
    role: "ASKER_3";
    questionId: string;
    answerDeadline: string | null;
    amountUsdc: string | null;
  };
}

const actors = loadActors();
const state: HarnessState = existsSync(STATE_PATH)
  ? (JSON.parse(readFileSync(STATE_PATH, "utf8")) as HarnessState)
  : {};
const pending = state.reclaim;
const deadlineMs = pending?.answerDeadline ? Date.parse(pending.answerDeadline) : Number.NaN;
const mature = Number.isFinite(deadlineMs) && Date.now() >= deadlineMs;

test.describe("harness: reclaim after the 7-day window (matured)", () => {
  test.skip(
    !actors || !RPC_URL || !RECONCILE_TOKEN,
    "harness not configured — see e2e/README.md (§ multi-actor harness)",
  );
  test.skip(
    !pending,
    "no question is waiting to be reclaimed — run the harness first (`pnpm run test:harness`)",
  );
  test.skip(
    Boolean(pending) && !mature,
    `the reclaim target isn't mature yet — reclaimable after ${pending?.answerDeadline}`,
  );

  test("ASKER_3 reclaims the expired question in full and withdraws", async ({ browser }) => {
    test.setTimeout(600_000);
    const cast = actors;
    const target = pending;
    if (!cast || !target) return;

    expect(await indexerReady(), "the indexer must be running (use `pnpm run test:reclaim`)").toBe(
      true,
    );
    const stop = startReconcileNudger();
    let s: ActorSession | null = null;
    try {
      const amount = BigInt(target.amountUsdc ?? "0");
      expect(amount, "the recorded escrow amount").toBeGreaterThan(0n);

      s = await openActor(browser, cast.ASKER_3);
      await signIn(s);

      const before = await readQuestion(s, target.questionId);
      expect(before.status, "the target must still be open to reclaim").toBe("open");

      const creditBefore = await withdrawable(s.actor.address);
      await reclaimQuestion(s, target.questionId);
      expect((await readQuestion(s, target.questionId)).status).toBe("reclaimed");

      // Reclaim is free: the asker gets the whole escrow back, with no fee (unlike cancel).
      const creditAfter = await withdrawable(s.actor.address);
      expect(creditAfter - creditBefore, "reclaim refunds 100%, no fee").toBe(amount);

      const walletBefore = await usdcBalance(s.actor.address);
      await withdrawAll(s);
      const walletAfter = await usdcBalance(s.actor.address);
      expect(walletAfter - walletBefore).toBe(creditAfter);

      console.log(
        `\nreclaim: question ${target.questionId} refunded ${usdc(amount)} in full, withdrawn ${usdc(creditAfter)}\n`,
      );
    } finally {
      stop();
      await s?.context.close().catch(() => {});
    }
  });
});
