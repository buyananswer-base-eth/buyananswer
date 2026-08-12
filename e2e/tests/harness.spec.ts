// SPDX-License-Identifier: MIT
// The Session-17 pre-deploy dry run: FIVE real users, five browser contexts, one live Base Sepolia
// escrow — every money path exercised through the product's own UI before the mainnet deploy.
//
// Cast (persistent, git-ignored keyset — `node scripts/wallets.mjs`):
//   CREATOR_A, CREATOR_B  answerers (gas only)
//   ASKER_1               pays via the **approve + askQuestion** fallback (wallet can't sign typed data)
//   ASKER_2               pays via the **EIP-2612 permit** path, then gets declined + refunded
//   ASKER_3               pays twice: one question it cancels, one left open for the 7-day reclaim
//
// Rules this suite keeps (they're the reason it's worth running):
//   · Every transaction is initiated by clicking the real UI; the headless wallet only answers prompts.
//   · Money-state is never forced — the indexer writes it from confirmed chain events (ADR-0024). We
//     only nudge `POST /reconcile` so its cron-paced work happens in seconds instead of minutes.
//   · Assertions read the chain (balances, the escrow's pull-payment ledger) and the API; the chain is
//     the source of truth for money.
//   · Testnet only. Without funds — or without the keyset/RPC/reconcile token — the whole suite SKIPS
//     with the addresses to fund, so it stays green on a machine that has none.
//
// Reclaim is 7-day gated on the live escrow, so it can't be driven here: the last path sets it up and
// prints when it matures; `reclaim-mature.spec.ts` finishes it through the UI when that day comes.

import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { formatUnits } from "viem";
import { type Actors, ROLES, type Role, loadActors } from "../harness/actors";
import {
  type EscrowParams,
  expectEventually,
  feeOn,
  fundingShortfall,
  readEscrowParams,
  readFunding,
  usdc,
  usdcAllowance,
  usdcBalance,
  withdrawable,
} from "../harness/chain";
import { API_URL, ESCROW, RECONCILE_TOKEN, RPC_URL, STATE_PATH, USDC } from "../harness/env";
import { indexerReady, startReconcileNudger } from "../harness/reconcile";
import {
  note,
  recordBalanceAfter,
  recordBalanceBefore,
  recordPath,
  recordTx,
  saveReport,
} from "../harness/report";
import {
  type ActorSession,
  type AskResult,
  answerQuestion,
  askAndPay,
  cancelQuestion,
  declineQuestion,
  ensureCreatorProfile,
  expectAnswerHidden,
  expectAnswerVisible,
  expectBoardLive,
  openActor,
  openAskComposer,
  publishAnswer,
  readQuestion,
  sentTo,
  setMinPrice,
  signIn,
  withdrawAll,
} from "../harness/ui";

/** One question costs the board minimum: 1 USDC (the API's floor). Keep testnet spend tiny. */
const AMOUNT = 1_000_000n;
const AMOUNT_TEXT = "1";

const actors: Actors | null = loadActors();
const configured = Boolean(actors) && Boolean(RPC_URL) && Boolean(RECONCILE_TOKEN);

test.describe.configure({ mode: "serial" });

test.describe("harness: five users, every money path, live Base Sepolia", () => {
  test.skip(
    !configured,
    "harness not configured — run `node scripts/wallets.mjs`, then set E2E_RPC_URL + E2E_RECONCILE_TOKEN in e2e/.env",
  );

  /** Set once the preflight finds a blocker (no funds / no indexer); every test then skips cleanly. */
  let skipReason: string | null = null;
  let params: EscrowParams;
  let stopNudger: (() => void) | null = null;
  const s = {} as Record<Role, ActorSession>;

  /** What each path produced, threaded between the serial tests. */
  const blank = (): AskResult => ({ id: "", hash: null, retries: [] });
  const q = { answered: blank(), declined: blank(), cancelled: blank(), open: blank() };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const cast = actors;
    if (!cast) return;

    // One browser context per actor, each with its own wallet + cookie session. Sign-in is a
    // signature, so this (and the onboarding path) works with no funds at all.
    for (const role of ROLES) {
      // ASKER_1's wallet cannot sign EIP-712, so its ask takes the approve + askQuestion fallback.
      s[role] = await openActor(browser, cast[role], {
        ...(role === "ASKER_1" ? { signTypedData: false } : {}),
      });
    }
    for (const role of ROLES) await signIn(s[role]);

    // Fail-soft preflight for the MONEY paths only — the point of the harness being runnable, and
    // partly verifiable, before the owner has funded anything.
    const funding = await readFunding(cast);
    for (const row of funding) recordBalanceBefore(row.role, row.address, row.usdc);
    skipReason = fundingShortfall(funding);
    if (skipReason) {
      console.log(`\n${skipReason}\n`);
      return;
    }
    if (!(await indexerReady())) {
      skipReason =
        "the indexer isn't reachable at E2E_INDEXER_URL with E2E_RECONCILE_TOKEN — run `pnpm run test:harness` (it boots the indexer against Base Sepolia and shares the API's local D1)";
      return;
    }

    params = await readEscrowParams();
    note(
      `escrow ${ESCROW} · fee ${params.feeAddress} · answer ${Number(params.answerFeeBps) / 100}% · cancel ${Number(params.cancelFeeBps) / 100}% · window ${Number(params.answerWindowSeconds) / 86_400}d`,
    );
    stopNudger = startReconcileNudger();
  });

  /** Guard for every path that moves money; the onboarding path deliberately doesn't use it. */
  const requireFunds = () => test.skip(Boolean(skipReason), skipReason ?? "");

  test.afterAll(async () => {
    stopNudger?.();
    if (!skipReason && actors) {
      try {
        for (const role of ROLES) {
          recordBalanceAfter(role, await usdcBalance(actors[role].address));
        }
      } catch {
        // a closing RPC hiccup must not fail the run — the report just shows "—" for the delta
      }
    }
    for (const role of ROLES) await s[role]?.context.close().catch(() => {});
    console.log(saveReport());
  });

  // ── onboarding ────────────────────────────────────────────────────────────────────────────────

  test("onboard: both creators sign in, own a handle, set their price, and go live", async () => {
    test.setTimeout(300_000);
    const notes: string[] = [];
    for (const [role, prefix] of [
      ["CREATOR_A", "e2e_a"],
      ["CREATOR_B", "e2e_b"],
    ] as const) {
      const handle = await ensureCreatorProfile(s[role], prefix);
      await setMinPrice(s[role], AMOUNT_TEXT);
      await expectBoardLive(s[role], handle);
      notes.push(`${role} → @${handle} (min ${AMOUNT_TEXT} USDC, board live)`);
    }
    recordPath("onboard — creator sign-in → handle → price → live board", "pass", notes);
  });

  test("ask surface: an asker reaches the composer from the board (no funds needed)", async () => {
    test.setTimeout(180_000);
    // Deliberately NOT gated on funding: this proves the board → CTA → AskGate → composer chain
    // still resolves for a signed-in asker on Base Sepolia, which is verifiable before any money.
    const handle = s.CREATOR_A.handle as string;
    await openAskComposer(s.ASKER_1, handle);
    await expect(s.ASKER_1.page.getByLabel(/amount \(usdc\)/i)).toHaveValue(AMOUNT_TEXT);
    await expect(s.ASKER_1.page.getByRole("button", { name: /ask & pay/i })).toBeVisible();
    recordPath("ask surface — board CTA → gate → composer (ASKER_1)", "pass", [
      `/ask/${handle} composes at the creator's ${AMOUNT_TEXT} USDC minimum`,
    ]);
  });

  // ── ask + pay ─────────────────────────────────────────────────────────────────────────────────

  test("ask + pay (approve fallback): ASKER_1 escrows 1 USDC for CREATOR_A", async () => {
    test.setTimeout(420_000);
    requireFunds();
    const asker = s.ASKER_1;
    const before = await usdcBalance(asker.actor.address);
    const txsBefore = asker.sent.length;
    // A successful ask consumes exactly the allowance it approved, so this is normally 0 and the UI
    // must approve. It can be non-zero only after a run that died between the approve and the ask —
    // in which case the UI's own fast path (allowance already covers it) is the correct behaviour.
    const allowanceBefore = await usdcAllowance(asker.actor.address);

    const res = await askAndPay(asker, {
      handle: s.CREATOR_A.handle as string,
      body: "Harness: what should we check before the mainnet deploy?",
      amountUsdc: AMOUNT_TEXT,
    });
    q.answered = res;

    // This wallet cannot sign EIP-712, so the permit path is impossible: the UI either approved first
    // or went straight to the ask on a pre-existing allowance. Either way, exactly one escrow call.
    const approves = sentTo(asker, USDC, txsBefore);
    expect(
      approves,
      "approve fallback: one approve when the allowance was short, none when it wasn't",
    ).toHaveLength(allowanceBefore < AMOUNT ? 1 : 0);
    expect(sentTo(asker, ESCROW, txsBefore), "exactly one escrow askQuestion").toHaveLength(1);

    const question = await readQuestion(asker, res.id);
    expect(question.status).toBe("open");
    expect(question.onchainId).not.toBeNull();
    expect(question.amountUsdc).toBe(AMOUNT.toString());

    await expectEventually(
      async () => before - (await usdcBalance(asker.actor.address)),
      AMOUNT,
      "exactly the escrowed amount leaves the asker",
    );
    const after = await usdcBalance(asker.actor.address);

    recordTx("ASKER_1 approve", approves[0]?.hash);
    recordTx("ASKER_1 askQuestion", res.hash);
    recordPath("ask + pay (approve + askQuestion) — ASKER_1 → CREATOR_A", "pass", [
      `question ${res.id} · on-chain #${question.onchainId} · −${usdc(before - after)}`,
      approves.length
        ? "approve + askQuestion (no permit — this wallet can't sign EIP-712)"
        : `fast path: allowance already covered it (${usdc(allowanceBefore)} left by an earlier run)`,
      ...res.retries.map((r) => `recovered via the UI's "Try again": ${r}`),
    ]);
  });

  test("ask + pay (permit): ASKER_2 escrows 1 USDC for CREATOR_A in a single signature", async () => {
    test.setTimeout(420_000);
    requireFunds();
    const asker = s.ASKER_2;
    const before = await usdcBalance(asker.actor.address);
    const txsBefore = asker.sent.length;

    const res = await askAndPay(asker, {
      handle: s.CREATOR_A.handle as string,
      body: "Harness: this one gets declined — the refund should be 100%.",
      amountUsdc: AMOUNT_TEXT,
    });
    q.declined = res;

    // The permit path is one transaction: no separate approve ever touches USDC.
    expect(sentTo(asker, USDC, txsBefore), "permit path sends no approve tx").toHaveLength(0);
    expect(sentTo(asker, ESCROW, txsBefore), "one askQuestionWithPermit").toHaveLength(1);

    expect((await readQuestion(asker, res.id)).status).toBe("open");
    await expectEventually(
      async () => before - (await usdcBalance(asker.actor.address)),
      AMOUNT,
      "exactly the escrowed amount leaves ASKER_2",
    );
    const after = await usdcBalance(asker.actor.address);

    recordTx("ASKER_2 askQuestionWithPermit", res.hash);
    recordPath("ask + pay (permit) — ASKER_2 → CREATOR_A", "pass", [
      `question ${res.id} · single signature, no approve tx · −${usdc(before - after)}`,
      ...res.retries.map((r) => `recovered via the UI's "Try again": ${r}`),
    ]);
  });

  test("ask + pay: ASKER_3 escrows two questions for CREATOR_B (one to cancel, one to reclaim)", async () => {
    test.setTimeout(600_000);
    requireFunds();
    const asker = s.ASKER_3;
    const before = await usdcBalance(asker.actor.address);
    const handle = s.CREATOR_B.handle as string;

    q.cancelled = await askAndPay(asker, {
      handle,
      body: "Harness: the asker cancels this one before the deadline.",
      amountUsdc: AMOUNT_TEXT,
    });
    q.open = await askAndPay(asker, {
      handle,
      body: "Harness: this one is left open on purpose, to be reclaimed after the 7-day window.",
      amountUsdc: AMOUNT_TEXT,
    });

    for (const id of [q.cancelled.id, q.open.id]) {
      expect((await readQuestion(asker, id)).status).toBe("open");
    }
    await expectEventually(
      async () => before - (await usdcBalance(asker.actor.address)),
      AMOUNT * 2n,
      "both escrows leave ASKER_3",
    );
    const after = await usdcBalance(asker.actor.address);

    recordTx("ASKER_3 ask (to cancel)", q.cancelled.hash);
    recordTx("ASKER_3 ask (to reclaim)", q.open.hash);
    recordPath("ask + pay ×2 (permit) — ASKER_3 → CREATOR_B", "pass", [
      `cancel-target ${q.cancelled.id} · reclaim-target ${q.open.id} · −${usdc(before - after)}`,
      ...[...q.cancelled.retries, ...q.open.retries].map((r) => `recovered via "Try again": ${r}`),
    ]);
  });

  // ── the paywall ───────────────────────────────────────────────────────────────────────────────

  test("paywall: an open question exposes no answer to the asker, in the UI or the API", async () => {
    test.setTimeout(180_000);
    requireFunds();
    await expectAnswerHidden(s.ASKER_1, q.answered.id);
    recordPath("paywall — open question, asker's view", "pass", [
      `question ${q.answered.id} is Open · no Answer card in the UI · GET /questions/:id → answer: null`,
    ]);
  });

  // ── answer → reveal → payout ──────────────────────────────────────────────────────────────────

  test("answer + reveal + payout: CREATOR_A answers, is credited amount − fee, and withdraws", async () => {
    test.setTimeout(600_000);
    requireFunds();
    const creator = s.CREATOR_A;
    const answerText = `harness answer ${Date.now().toString(36)} — deploy checklist: fees, owner, pause.`;
    const fee = feeOn(AMOUNT, params.answerFeeBps);
    const payout = AMOUNT - fee;

    const creditBefore = await withdrawable(creator.actor.address);
    const feeCreditBefore = await withdrawable(params.feeAddress);
    const txsBefore = creator.sent.length;

    await answerQuestion(creator, q.answered.id, answerText);

    // Chain = truth: the escrow credited the payout to the creator and the fee to the fee address.
    await expectEventually(
      async () => (await withdrawable(creator.actor.address)) - creditBefore,
      payout,
      "creator is credited the amount minus the fee",
    );
    await expectEventually(
      async () => (await withdrawable(params.feeAddress)) - feeCreditBefore,
      fee,
      "the platform fee is credited to feeAddress",
    );
    const creditAfter = await withdrawable(creator.actor.address);

    // Only now does the asker get the answer — the paywall opened on the indexed `answered`.
    await expectAnswerVisible(s.ASKER_1, q.answered.id, answerText);
    expect((await readQuestion(creator, q.answered.id)).status).toBe("answered");

    // Pull payment: money reaches the wallet only via withdraw().
    const walletBefore = await usdcBalance(creator.actor.address);
    await withdrawAll(creator);
    await expectEventually(
      async () => (await usdcBalance(creator.actor.address)) - walletBefore,
      creditAfter,
      "withdraw pays out the full credited balance",
    );
    await expectEventually(
      () => withdrawable(creator.actor.address),
      0n,
      "nothing is left credited after withdrawing",
    );

    recordTx("CREATOR_A answerQuestion", creator.sent.slice(txsBefore)[0]?.hash);
    recordTx("CREATOR_A withdraw", creator.sent.at(-1)?.hash);
    recordPath("answer → reveal → payout → withdraw — CREATOR_A", "pass", [
      `payout ${usdc(payout)} (fee ${usdc(fee)} to ${params.feeAddress})`,
      "answer revealed to ASKER_1 only after the indexer wrote `answered`",
      `withdrew ${usdc(creditAfter)} to the wallet`,
    ]);
    note(
      `fee credited on answer: ${usdc(fee)} → ${params.feeAddress} (never withdrawn by the harness)`,
    );
  });

  // ── decline → 100% refund ─────────────────────────────────────────────────────────────────────

  test("decline + refund: CREATOR_A declines ASKER_2, who is refunded in full and withdraws", async () => {
    test.setTimeout(600_000);
    requireFunds();
    const creditBefore = await withdrawable(s.ASKER_2.actor.address);
    const txsBefore = s.CREATOR_A.sent.length;

    await declineQuestion(s.CREATOR_A, q.declined.id);
    expect((await readQuestion(s.ASKER_2, q.declined.id)).status).toBe("declined");

    await expectEventually(
      async () => (await withdrawable(s.ASKER_2.actor.address)) - creditBefore,
      AMOUNT,
      "a decline refunds 100%, no fee",
    );
    const creditAfter = await withdrawable(s.ASKER_2.actor.address);

    const walletBefore = await usdcBalance(s.ASKER_2.actor.address);
    await withdrawAll(s.ASKER_2);
    await expectEventually(
      async () => (await usdcBalance(s.ASKER_2.actor.address)) - walletBefore,
      creditAfter,
      "ASKER_2 withdraws the full refund",
    );

    recordTx("CREATOR_A declineQuestion", s.CREATOR_A.sent.slice(txsBefore)[0]?.hash);
    recordTx("ASKER_2 withdraw", s.ASKER_2.sent.at(-1)?.hash);
    recordPath("decline → 100% refund → withdraw — CREATOR_A / ASKER_2", "pass", [
      `refund ${usdc(AMOUNT)} (no fee) · withdrew ${usdc(creditAfter)}`,
    ]);
  });

  // ── cancel → refund − fee ─────────────────────────────────────────────────────────────────────

  test("cancel + refund: ASKER_3 cancels before the deadline, refunded minus the cancel fee", async () => {
    test.setTimeout(600_000);
    requireFunds();
    const fee = feeOn(AMOUNT, params.cancelFeeBps);
    const refund = AMOUNT - fee;
    const creditBefore = await withdrawable(s.ASKER_3.actor.address);
    const feeCreditBefore = await withdrawable(params.feeAddress);
    const txsBefore = s.ASKER_3.sent.length;

    await cancelQuestion(s.ASKER_3, q.cancelled.id);
    expect((await readQuestion(s.ASKER_3, q.cancelled.id)).status).toBe("cancelled");

    await expectEventually(
      async () => (await withdrawable(s.ASKER_3.actor.address)) - creditBefore,
      refund,
      "cancel refunds the amount minus the cancel fee",
    );
    await expectEventually(
      async () => (await withdrawable(params.feeAddress)) - feeCreditBefore,
      fee,
      "the cancel fee is credited to feeAddress",
    );
    const creditAfter = await withdrawable(s.ASKER_3.actor.address);

    const walletBefore = await usdcBalance(s.ASKER_3.actor.address);
    await withdrawAll(s.ASKER_3);
    await expectEventually(
      async () => (await usdcBalance(s.ASKER_3.actor.address)) - walletBefore,
      creditAfter,
      "ASKER_3 withdraws the full refund",
    );

    recordTx("ASKER_3 cancelQuestion", s.ASKER_3.sent.slice(txsBefore)[0]?.hash);
    recordTx("ASKER_3 withdraw", s.ASKER_3.sent.at(-1)?.hash);
    recordPath("cancel → refund − fee → withdraw — ASKER_3", "pass", [
      `refund ${usdc(refund)} · cancel fee ${usdc(fee)} → ${params.feeAddress}`,
    ]);
  });

  // ── publish ───────────────────────────────────────────────────────────────────────────────────

  test("publish: CREATOR_A publishes the answered Q&A and the public card renders", async ({
    request,
  }) => {
    test.setTimeout(180_000);
    requireFunds();
    await publishAnswer(s.CREATOR_A, q.answered.id);

    // Anonymous read of the public card (no cookies): the sharing surface the publish flow unlocks.
    const res = await request.get(`${API_URL}/p/${q.answered.id}`);
    expect(res.status(), "the published card is public").toBe(200);
    const card = (await res.json()) as {
      answer: { body: string } | null;
      creator: { handle: string } | null;
    };
    expect(card.answer?.body).toBeTruthy();
    expect(card.creator?.handle).toBe(s.CREATOR_A.handle);

    recordPath("publish → public Q&A card — CREATOR_A", "pass", [
      `GET /p/${q.answered.id} → 200, answer + @${card.creator?.handle} rendered anonymously`,
      "note: the public card is an API surface today; the web /p/:id page is still deferred (ADR-0028)",
    ]);
  });

  // ── reclaim (7-day gated) ─────────────────────────────────────────────────────────────────────

  test("reclaim: ASKER_3's second question is left open and matures in 7 days", async () => {
    test.setTimeout(120_000);
    requireFunds();
    const question = await readQuestion(s.ASKER_3, q.open.id);
    expect(question.status, "the reclaim target stays open").toBe("open");
    expect(question.answerDeadline).not.toBeNull();

    // The asker's action surface is deadline-driven: before it, the UI offers Cancel, not Reclaim.
    await expectAnswerHidden(s.ASKER_3, q.open.id);
    await expect(
      s.ASKER_3.page.getByRole("button", { name: "Cancel & refund", exact: true }),
    ).toBeVisible();

    writeFileSync(
      STATE_PATH,
      `${JSON.stringify(
        {
          reclaim: {
            role: "ASKER_3",
            questionId: q.open.id,
            answerDeadline: question.answerDeadline,
            amountUsdc: question.amountUsdc,
            creatorHandle: s.CREATOR_B.handle,
          },
        },
        null,
        2,
      )}\n`,
    );

    const when = question.answerDeadline as string;
    note(`reclaimable after ${when} — run \`pnpm run test:reclaim\` on or after that date`);
    recordPath("reclaim — set up, 7-day gated on the live escrow", "pass", [
      `question ${q.open.id} left open · reclaimable after ${when}`,
      "finish it with `pnpm run test:reclaim` (reclaim itself is already proven by the forge invariant/unit suite)",
    ]);
  });

  // ── solvency ──────────────────────────────────────────────────────────────────────────────────

  test("solvency: the escrow still holds at least everything it owes this cast", async () => {
    test.setTimeout(120_000);
    requireFunds();
    const cast = actors as Actors;
    const credits = await Promise.all(
      [...ROLES.map((r) => cast[r].address), params.feeAddress].map((a) => withdrawable(a)),
    );
    const owed = credits.reduce((sum, c) => sum + c, 0n) + AMOUNT; // + the still-open reclaim target
    const held = await usdcBalance(ESCROW);
    expect(
      held,
      "escrow USDC must cover every credit we know about plus the open escrow",
    ).toBeGreaterThanOrEqual(owed);

    note(
      `solvency: escrow holds ${formatUnits(held, 6)} USDC ≥ ${formatUnits(owed, 6)} owed to this cast (credits + 1 open escrow)`,
    );
    recordPath("solvency sanity — escrow covers every credit we can see", "pass", [
      `held ${usdc(held)} ≥ owed ${usdc(owed)}`,
    ]);
  });
});
