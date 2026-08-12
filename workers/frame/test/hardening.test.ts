// SPDX-License-Identifier: MIT
// Session 14 frame hardening (ADR-0032): the tx-ask qid↔asker binding (a crafted client can't point a
// signed state at another minter's ref), per-fid rate limiting of the frame POSTs, and the orphan sweep
// that prunes abandoned pending_payment drafts without ever touching a row the indexer has advanced.

import { questions } from "@buyananswer/shared";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { encodeState } from "../src/frame/state.js";
import { FRAME_LIMIT } from "../src/lib/limits.js";
import { sweepOrphanedPendingPayments } from "../src/lib/sweep.js";
import {
  ANSWERER,
  ASKER,
  FakeVerifier,
  allQuestions,
  db,
  get,
  postAction,
  seedCreator,
  verifiedAction,
} from "./helpers.js";

const ATTACKER = "0x3333333333333333333333333333333333333333" as const;

/** Pull a `fc:frame:*` meta content value out of rendered frame HTML. */
function meta(html: string, property: string): string | undefined {
  return html.match(new RegExp(`property="${property}"\\s+content="([^"]*)"`))?.[1];
}

/** Mint a pending_payment draft for ASKER via the frame flow; return its id + the confirm-frame state. */
async function mintAsAsker(): Promise<{ id: string; state: string }> {
  const app = createApp(() => new FakeVerifier(verifiedAction({ address: ASKER })));
  const res = await postAction(app, "/f/satoshi/after-approve");
  const html = await res.text();
  const state = meta(html, "fc:frame:state");
  if (!state) throw new Error("expected a confirm-frame state");
  const rows = await allQuestions();
  const row = rows[0];
  if (!row) throw new Error("expected a minted row");
  return { id: row.id, state };
}

describe("tx-ask qid↔asker binding (ADR-0032)", () => {
  it("rejects a ref whose signed state was minted by a different asker", async () => {
    await seedCreator({ handle: "satoshi", wallet: ANSWERER, minPriceUsdc: "2000000" });
    const { state } = await mintAsAsker();

    // A different verified fid/wallet replays ASKER's signed state (which carries asker = ASKER).
    const attackerApp = createApp(
      () => new FakeVerifier(verifiedAction({ fid: 99, address: ATTACKER, state })),
    );
    const res = await postAction(attackerApp, "/f/satoshi/tx-ask");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message?: string }).message).toBeTruthy();
  });

  it("rejects via the stored-row check even when the state omits the asker", async () => {
    await seedCreator({ handle: "satoshi", wallet: ANSWERER, minPriceUsdc: "2000000" });
    const { id } = await mintAsAsker();

    // An asker-less state (old shape) pointing at ASKER's ref — the DB owner check is the backstop.
    const forged = encodeState({ qid: id });
    const attackerApp = createApp(
      () => new FakeVerifier(verifiedAction({ fid: 99, address: ATTACKER, state: forged })),
    );
    const res = await postAction(attackerApp, "/f/satoshi/tx-ask");
    expect(res.status).toBe(400);
  });

  it("still builds the ask tx for the asker who minted the ref", async () => {
    await seedCreator({ handle: "satoshi", wallet: ANSWERER, minPriceUsdc: "2000000" });
    const { state } = await mintAsAsker();
    const app = createApp(() => new FakeVerifier(verifiedAction({ address: ASKER, state })));
    const res = await postAction(app, "/f/satoshi/tx-ask");
    expect(res.status).toBe(200);
    expect((await res.json()) as { method?: string }).toMatchObject({
      method: "eth_sendTransaction",
    });
  });
});

describe("per-fid rate limiting of frame POSTs (ADR-0032)", () => {
  it("mints while allowed, then returns a rate-limited (error) frame for the same fid", async () => {
    await seedCreator({ handle: "satoshi", wallet: ANSWERER, minPriceUsdc: "2000000" });
    const app = createApp(() => new FakeVerifier(verifiedAction({ address: ASKER })));

    // Burst 2*limit+1 so a real-clock minute boundary can't hide the limit (one window must exceed it).
    const images: (string | undefined)[] = [];
    for (let i = 0; i < FRAME_LIMIT.limit * 2 + 1; i++) {
      const res = await postAction(app, "/f/satoshi/after-approve");
      images.push(meta(await res.text(), "fc:frame:image"));
    }
    // The first action (fresh window) mints → the confirm frame.
    expect(images[0]).toContain("confirm.png");
    // At least one action is denied → the error frame (never mints past the limit).
    expect(images.some((img) => img?.includes("notfound.png"))).toBe(true);
  });

  it("does not rate-limit the GET ask frame (reads are unlimited)", async () => {
    await seedCreator({ handle: "satoshi" });
    const app = createApp();
    for (let i = 0; i < FRAME_LIMIT.limit + 5; i++) {
      expect((await get(app, "/f/satoshi")).status).toBe(200);
    }
  });
});

describe("orphan pending_payment sweep (ADR-0032)", () => {
  const NOW = new Date("2026-08-11T12:00:00.000Z");
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000);

  async function seedQuestion(over: {
    id: string;
    status?: string;
    onchainId?: string | null;
    createdAt: Date;
  }) {
    await db()
      .insert(questions)
      .values({
        id: over.id,
        chainId: 84532,
        askerWallet: ASKER,
        answererWallet: ANSWERER,
        body: "why is the sky blue?",
        status: (over.status ?? "pending_payment") as "pending_payment",
        onchainId: over.onchainId ?? null,
        createdAt: over.createdAt,
      });
  }

  it("deletes only aged, unpaid, still-pending drafts", async () => {
    await seedCreator({ handle: "satoshi", wallet: ANSWERER });
    await seedQuestion({ id: "aaaaaaaa-0000-4000-8000-000000000001", createdAt: hoursAgo(48) }); // swept
    await seedQuestion({ id: "bbbbbbbb-0000-4000-8000-000000000002", createdAt: hoursAgo(1) }); // too new
    await seedQuestion({
      id: "cccccccc-0000-4000-8000-000000000003",
      status: "open",
      onchainId: "5",
      createdAt: hoursAgo(48),
    }); // indexer-advanced — never touched

    const result = await sweepOrphanedPendingPayments(db(), {
      olderThanSeconds: 24 * 3600,
      now: NOW,
    });

    expect(result.deleted).toBe(1);
    expect(result.ids).toEqual(["aaaaaaaa-0000-4000-8000-000000000001"]);
    const remaining = (await allQuestions()).map((q) => q.id).sort();
    expect(remaining).toEqual([
      "bbbbbbbb-0000-4000-8000-000000000002",
      "cccccccc-0000-4000-8000-000000000003",
    ]);
  });

  it("is a no-op when nothing is old enough", async () => {
    await seedCreator({ handle: "satoshi", wallet: ANSWERER });
    await seedQuestion({ id: "dddddddd-0000-4000-8000-000000000004", createdAt: hoursAgo(2) });
    const result = await sweepOrphanedPendingPayments(db(), {
      olderThanSeconds: 24 * 3600,
      now: NOW,
    });
    expect(result.deleted).toBe(0);
    expect(await allQuestions()).toHaveLength(1);
  });
});
