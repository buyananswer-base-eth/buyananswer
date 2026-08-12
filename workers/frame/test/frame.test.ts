// SPDX-License-Identifier: MIT
// End-to-end frame behaviour against a real workerd + D1 (mocked hub via a fake verifier): the GET ask
// frame, the two-transaction approve → askQuestion flow (asserting well-formed Base txs whose calldata
// matches the shared SDK exactly), the chain-first mint, and the invariant that the frame NEVER writes
// money-state. Also the fail-closed paths (rejected signature, missing wallet, empty question).

import { encodeApprove, encodeAskQuestion, refForQuestion } from "@buyananswer/sdk";
import { getEscrowDeployment, requireEscrowAddress } from "@buyananswer/shared";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import {
  ANSWERER,
  ASKER,
  FakeVerifier,
  allQuestions,
  get,
  getQuestionRow,
  postAction,
  seedCreator,
  verifiedAction,
} from "./helpers.js";

const CHAIN_ID = 84532;
const AMOUNT = 2_000_000n;
const escrow = requireEscrowAddress(CHAIN_ID);
const usdc = getEscrowDeployment(CHAIN_ID)?.usdc;

/** Pull a `fc:frame:*` meta content value out of rendered frame HTML (properties are regex-safe). */
function meta(html: string, property: string): string | undefined {
  const re = new RegExp(`property="${property}"\\s+content="([^"]*)"`);
  return html.match(re)?.[1];
}

describe("GET /f/:handle", () => {
  it("renders a valid ask frame for a claimed creator", async () => {
    await seedCreator({ handle: "satoshi" });
    const app = createApp();
    const res = await get(app, "/f/satoshi");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();

    expect(meta(html, "fc:frame")).toBe("vNext");
    expect(meta(html, "fc:frame:image")).toBe("http://localhost:5173/frame/ask.png");
    expect(meta(html, "fc:frame:image:aspect_ratio")).toBe("1.91:1");
    expect(meta(html, "fc:frame:input:text")).toBeTruthy();
    // Button 1 is the transaction trigger (approve first), with a post-tx callback.
    expect(meta(html, "fc:frame:button:1:action")).toBe("tx");
    expect(meta(html, "fc:frame:button:1:target")).toBe("https://frame.test/f/satoshi/tx-approve");
    expect(meta(html, "fc:frame:button:1:post_url")).toBe(
      "https://frame.test/f/satoshi/after-approve",
    );
    // Button 2 deep-links to the web ask page (for a long body / custom amount).
    expect(meta(html, "fc:frame:button:2:action")).toBe("link");
    expect(meta(html, "fc:frame:button:2:target")).toBe("http://localhost:5173/ask/satoshi");
  });

  it("renders a not-found frame for an unclaimed handle", async () => {
    const app = createApp();
    const res = await get(app, "/f/nobody");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(meta(html, "fc:frame")).toBe("vNext");
    expect(meta(html, "fc:frame:button:1:action")).toBe("link");
    expect(meta(html, "fc:frame:input:text")).toBeUndefined();
  });

  it("renders a not-found frame for a malformed handle (no API hit)", async () => {
    const app = createApp();
    const res = await get(app, "/f/BAD!!");
    expect(res.status).toBe(200);
    expect(meta(await res.text(), "fc:frame:button:1:action")).toBe("link");
  });
});

describe("the two-transaction ask flow", () => {
  it("approves USDC, mints the question, then asks — chain-first, no money-state", async () => {
    await seedCreator({ handle: "satoshi", wallet: ANSWERER, minPriceUsdc: AMOUNT.toString() });
    const app = createApp(() => new FakeVerifier(verifiedAction({ address: ASKER })));

    // 1) tx-approve → a Base USDC approve for exactly the min price.
    const approveRes = await postAction(app, "/f/satoshi/tx-approve");
    expect(approveRes.status).toBe(200);
    const approve = await approveRes.json();
    expect(approve).toEqual({
      chainId: "eip155:84532",
      method: "eth_sendTransaction",
      params: {
        abi: expect.any(Array),
        to: usdc,
        data: encodeApprove(escrow, AMOUNT),
        value: "0",
      },
    });

    // 2) after-approve → mints the pending_payment row + returns the "confirm" frame with state.
    const afterApprove = await postAction(app, "/f/satoshi/after-approve");
    expect(afterApprove.status).toBe(200);
    const confirmHtml = await afterApprove.text();
    const state = meta(confirmHtml, "fc:frame:state");
    if (!state) throw new Error("expected the confirm frame to carry state");
    expect(meta(confirmHtml, "fc:frame:button:1:target")).toBe(
      "https://frame.test/f/satoshi/tx-ask",
    );

    const rows = await allQuestions();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error("expected a minted question row");
    expect(row.status).toBe("pending_payment");
    expect(row.askerWallet).toBe(ASKER);
    expect(row.answererWallet).toBe(ANSWERER);
    expect(row.body).toBe("why is the sky blue?");
    // Money-state columns are the indexer's alone — the frame must leave them untouched.
    expect(row.onchainId).toBeNull();
    expect(row.amountUsdc).toBeNull();
    expect(row.answerDeadline).toBeNull();

    // 3) tx-ask → the askQuestion tx, ref = the minted UUID, matching the SDK encoder exactly.
    const askApp = createApp(() => new FakeVerifier(verifiedAction({ address: ASKER, state })));
    const askRes = await postAction(askApp, "/f/satoshi/tx-ask");
    expect(askRes.status).toBe(200);
    const ask = (await askRes.json()) as {
      chainId: string;
      params: { to: string; value: string; data: string };
    };
    expect(ask.chainId).toBe("eip155:84532");
    expect(ask.params.to).toBe(escrow);
    expect(ask.params.value).toBe("0");
    expect(ask.params.data).toBe(
      encodeAskQuestion({ ref: refForQuestion(row.id), answerer: ANSWERER, amount: AMOUNT }),
    );

    // 4) after-ask → the "held onchain" frame linking to the web question detail.
    const sentApp = createApp(
      () => new FakeVerifier(verifiedAction({ address: ASKER, state, transactionId: "0xabc" })),
    );
    const sentRes = await postAction(sentApp, "/f/satoshi/after-ask");
    const sentHtml = await sentRes.text();
    expect(meta(sentHtml, "fc:frame:button:1:target")).toBe(
      `http://localhost:5173/questions/${row.id}`,
    );

    // Still exactly one row, still pending_payment (the indexer, not the frame, moves it to `open`).
    const after = await getQuestionRow(row.id);
    expect(after?.status).toBe("pending_payment");
  });
});

describe("fail-closed paths", () => {
  it("rejects a tx action whose signature does not verify (400)", async () => {
    await seedCreator({ handle: "satoshi" });
    const app = createApp(() => new FakeVerifier(null));
    const res = await postAction(app, "/f/satoshi/tx-approve");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message?: string }).message).toBeTruthy();
    expect(await allQuestions()).toHaveLength(0);
  });

  it("does not mint when the connected wallet is missing", async () => {
    await seedCreator({ handle: "satoshi" });
    // No `address` on the verified action (a client that didn't attach a wallet).
    const app = createApp(
      () => new FakeVerifier({ fid: 42, buttonIndex: 1, inputText: "why?", state: "" }),
    );
    const res = await postAction(app, "/f/satoshi/after-approve");
    expect(res.status).toBe(200); // a valid (error) frame, not a crash
    expect(await allQuestions()).toHaveLength(0);
  });

  it("does not mint when the question is empty", async () => {
    await seedCreator({ handle: "satoshi" });
    const app = createApp(() => new FakeVerifier(verifiedAction({ inputText: "   " })));
    const res = await postAction(app, "/f/satoshi/after-approve");
    expect(res.status).toBe(200);
    expect(await allQuestions()).toHaveLength(0);
  });

  it("rejects an unparseable POST body (400)", async () => {
    await seedCreator({ handle: "satoshi" });
    // Even with a verifier that would accept, the missing trustedData/untrustedData makes
    // parseFramePostBody throw → the action is null → 400 (the parse guard runs before verify).
    const app = createApp(() => new FakeVerifier(verifiedAction()));
    const malformed = { note: "not a frame" } as unknown as Parameters<typeof postAction>[2];
    const res = await postAction(app, "/f/satoshi/tx-approve", malformed);
    expect(res.status).toBe(400);
  });
});
