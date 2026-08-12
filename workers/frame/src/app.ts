// SPDX-License-Identifier: MIT
// The frame Worker's HTTP surface — a Farcaster board/ask frame that mints a question and returns Base
// USDC transactions, all in-feed. The flow is chain-first (ADR-0027) and two transactions (approve →
// askQuestion), because a tx-frame returns exactly one transaction and cannot set new frame state:
//
//   GET  /f/:handle           → the ask frame: a question input + a "pay" transaction button.
//   POST /f/:handle/tx-approve → [tx] approve(escrow, minPrice) on USDC.
//   POST /f/:handle/after-approve → [frame] approve submitted → MINT the question row, show "confirm".
//   POST /f/:handle/tx-ask    → [tx] askQuestion(ref, answerer, minPrice) on the escrow.
//   POST /f/:handle/after-ask → [frame] askQuestion submitted → "held onchain, appears shortly".
//
// Every POST is signature-validated by a Farcaster hub (fail-closed) before we act on it — the asker is
// the hub-VERIFIED connected wallet, never untrusted input. Each POST is then rate-limited per verified
// fid (ADR-0032), and `tx-ask` binds the paid `ref` to the wallet that minted it. The frame never writes
// money-state; the indexer flips the row to `open` when it sees `QuestionAsked`.

import { toLowerAddress } from "@buyananswer/shared";
import { consoleErrorReporter, getLog, observability } from "@buyananswer/worker-kit";
import { Hono } from "hono";
import { copy, formatUsdc } from "./copy.js";
import { getDb } from "./db.js";
import { type Env, type FrameConfig, type FrameContext, resolveConfig } from "./env.js";
import { frameImageUrl } from "./frame/images.js";
import { type VerifiedFrameAction, parseFramePostBody } from "./frame/message.js";
import { frameResponse } from "./frame/meta.js";
import { decodeState, encodeState } from "./frame/state.js";
import { buildApproveTx, buildAskTx } from "./frame/tx.js";
import { type FrameVerifier, HubFrameVerifier } from "./frame/verify.js";
import { getCreatorByHandle, normalizeHandle } from "./lib/creator.js";
import { allowFrameAction } from "./lib/limits.js";
import { mintQuestion } from "./lib/mint.js";
import { getQuestionById } from "./lib/question.js";
import { SVC, track } from "./log.js";

/** Build the production verifier from config (talks to the configured hub). */
export type VerifierFactory = (config: FrameConfig) => FrameVerifier;
const defaultVerifierFactory: VerifierFactory = (config) =>
  new HubFrameVerifier(config.hubUrl, config.hubAuth);

/** The frame worker's own public origin, as the requesting client sees it (for target/post_url URLs). */
function frameOrigin(reqUrl: string): string {
  return new URL(reqUrl).origin;
}

/** Read + parse + hub-verify a frame POST body. Returns the verified action, or `null` (reject). */
async function verifiedAction(
  reqBody: unknown,
  verifier: FrameVerifier,
): Promise<VerifiedFrameAction | null> {
  let body: ReturnType<typeof parseFramePostBody>;
  try {
    body = parseFramePostBody(reqBody);
  } catch {
    return null;
  }
  return verifier.verify(body);
}

/**
 * Create the Hono app. `verifierFactory` is injectable so tests supply a fake verifier (no network),
 * mirroring the indexer's mocked ChainReader. Production uses the hub verifier.
 */
export function createApp(verifierFactory: VerifierFactory = defaultVerifierFactory) {
  const app = new Hono<FrameContext>();

  app.use("*", observability(SVC));

  app.onError((err, c) => {
    const path = new URL(c.req.url).pathname;
    consoleErrorReporter(getLog(c, SVC)).report(err, { method: c.req.method, path });
    return c.json({ error: "internal_error" }, 500);
  });
  app.notFound((c) => c.json({ error: "not_found" }, 404));

  app.get("/", (c) => c.json({ ok: true, service: SVC }));

  app.get("/health", (c) => {
    // Liveness + readiness. A fail-closed frame needs a hub to accept ANY ask, so `ready` requires one.
    let chainId: number | null = null;
    let hub = false;
    let ready = false;
    try {
      const config = resolveConfig(c.env);
      chainId = config.chainId;
      hub = Boolean(config.hubUrl);
      ready = Boolean(c.env.DB && c.env.RATELIMIT) && hub;
    } catch {
      /* leave not-ready — a hard misconfig surfaces here */
    }
    return c.json({ ok: true, service: SVC, chainId, hub, ready });
  });

  // ─── GET /f/:handle — the ask frame ────────────────────────────────────────
  app.get("/f/:handle", async (c) => {
    const config = resolveConfig(c.env);
    const origin = frameOrigin(c.req.url);
    const handle = normalizeHandle(c.req.param("handle"));
    const creator = handle ? await getCreatorByHandle(getDb(c.env), handle) : null;

    if (!creator || !handle) return frameResponse(notFoundFrame(config));

    const usdc = formatUsdc(BigInt(creator.minPriceUsdc));
    return frameResponse({
      title: copy.askTitle(creator.displayName),
      image: frameImageUrl(config, "ask"),
      input: "Ask your question…",
      buttons: [
        {
          label: copy.askButton(usdc),
          action: "tx",
          target: `${origin}/f/${handle}/tx-approve`,
          postUrl: `${origin}/f/${handle}/after-approve`,
        },
        { label: copy.openOnWeb, action: "link", target: `${config.appOrigin}/ask/${handle}` },
      ],
    });
  });

  // ─── POST /f/:handle/tx-approve — [tx] approve USDC ────────────────────────
  app.post("/f/:handle/tx-approve", async (c) => {
    const config = resolveConfig(c.env);
    const action = await verifiedAction(await safeJson(c), verifierFactory(config));
    if (!action) return c.json({ message: copy.rejected }, 400);
    if (!(await allowFrameAction(c.env, action.fid, c.get("log")))) {
      return c.json({ message: copy.rateLimited }, 429);
    }

    const handle = normalizeHandle(c.req.param("handle"));
    const creator = handle ? await getCreatorByHandle(getDb(c.env), handle) : null;
    if (!creator) return c.json({ message: copy.unknownCreator }, 400);

    return c.json(buildApproveTx(config, BigInt(creator.minPriceUsdc)));
  });

  // ─── POST /f/:handle/after-approve — [frame] mint + show confirm ───────────
  app.post("/f/:handle/after-approve", async (c) => {
    const config = resolveConfig(c.env);
    const origin = frameOrigin(c.req.url);
    const action = await verifiedAction(await safeJson(c), verifierFactory(config));
    if (!action) return frameResponse(errorFrame(config, copy.rejected));
    if (!(await allowFrameAction(c.env, action.fid, c.get("log")))) {
      return frameResponse(errorFrame(config, copy.rateLimited));
    }

    const handle = normalizeHandle(c.req.param("handle"));
    const creator = handle ? await getCreatorByHandle(getDb(c.env), handle) : null;
    if (!creator) return frameResponse(errorFrame(config, copy.unknownCreator));
    if (!action.address) return frameResponse(errorFrame(config, copy.needWallet));
    if (action.inputText.trim().length === 0) {
      return frameResponse(errorFrame(config, copy.needQuestion));
    }

    const result = await mintQuestion(getDb(c.env), {
      creator,
      asker: action.address,
      body: action.inputText,
      chainId: config.chainId,
    });
    if (!result.ok) return frameResponse(errorFrame(config, copy.needQuestion));

    track("frame_ask_started", {
      fid: action.fid,
      handle,
      questionId: result.id,
      chainId: config.chainId,
    });

    return frameResponse({
      title: copy.confirmTitle,
      image: frameImageUrl(config, "confirm"),
      // Bind the qid to the minting asker so tx-ask can reject a ref that isn't theirs (ADR-0032).
      state: encodeState({ qid: result.id, asker: toLowerAddress(action.address) }),
      buttons: [
        {
          label: copy.confirmButton,
          action: "tx",
          target: `${origin}/f/${handle}/tx-ask`,
          postUrl: `${origin}/f/${handle}/after-ask`,
        },
      ],
    });
  });

  // ─── POST /f/:handle/tx-ask — [tx] askQuestion ─────────────────────────────
  app.post("/f/:handle/tx-ask", async (c) => {
    const config = resolveConfig(c.env);
    const action = await verifiedAction(await safeJson(c), verifierFactory(config));
    if (!action) return c.json({ message: copy.rejected }, 400);
    if (!(await allowFrameAction(c.env, action.fid, c.get("log")))) {
      return c.json({ message: copy.rateLimited }, 429);
    }

    const state = decodeState(action.state);
    const handle = normalizeHandle(c.req.param("handle"));
    const db = getDb(c.env);
    const creator = handle ? await getCreatorByHandle(db, handle) : null;
    if (!state || !creator) return c.json({ message: copy.rejected }, 400);
    if (!action.address) return c.json({ message: copy.needWallet }, 400);

    // Bind the paid ref to the VERIFIED asker (ADR-0032). The signed state's `asker` is a first gate;
    // the authoritative check is the stored row: its asker (set at mint from a verified wallet) must be
    // this caller, and it must still be an unpaid draft addressed to this creator. This rejects a
    // crafted client that points a signed state at another minter's ref.
    const asker = toLowerAddress(action.address);
    if (state.asker && state.asker !== asker) return c.json({ message: copy.rejected }, 400);
    const question = await getQuestionById(db, state.qid);
    if (
      !question ||
      question.status !== "pending_payment" ||
      question.askerWallet !== asker ||
      question.answererWallet !== creator.wallet
    ) {
      c.get("log").warn("tx_ask_binding_rejected", { fid: action.fid, qid: state.qid });
      return c.json({ message: copy.rejected }, 400);
    }

    return c.json(
      buildAskTx(config, {
        questionId: state.qid,
        answerer: creator.wallet,
        amount: BigInt(creator.minPriceUsdc),
      }),
    );
  });

  // ─── POST /f/:handle/after-ask — [frame] held onchain ──────────────────────
  app.post("/f/:handle/after-ask", async (c) => {
    const config = resolveConfig(c.env);
    const action = await verifiedAction(await safeJson(c), verifierFactory(config));
    if (!action) return frameResponse(errorFrame(config, copy.rejected));
    if (!(await allowFrameAction(c.env, action.fid, c.get("log")))) {
      return frameResponse(errorFrame(config, copy.rateLimited));
    }

    const state = decodeState(action.state);
    const handle = normalizeHandle(c.req.param("handle"));
    if (!state) return frameResponse(errorFrame(config, copy.rejected));

    track("frame_payment_confirmed", {
      fid: action.fid,
      handle,
      questionId: state.qid,
      chainId: config.chainId,
      txId: action.transactionId ?? null,
    });

    return frameResponse({
      title: copy.sentTitle,
      image: frameImageUrl(config, "sent"),
      buttons: [
        {
          label: copy.sentButton,
          action: "link",
          target: `${config.appOrigin}/questions/${state.qid}`,
        },
      ],
    });
  });

  return app;
}

/** Read a request body as JSON, returning `null` on a missing/invalid body (never throws). */
async function safeJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

/** The "creator not found" frame (a valid frame so it still renders in-feed). */
function notFoundFrame(config: FrameConfig) {
  return {
    title: copy.notFoundTitle,
    image: frameImageUrl(config, "notfound"),
    buttons: [{ label: copy.goToSite, action: "link" as const, target: config.appOrigin }],
  };
}

/** A generic error frame carrying a short message (reuses the not-found image). */
function errorFrame(config: FrameConfig, message: string) {
  return {
    title: message,
    image: frameImageUrl(config, "notfound"),
    buttons: [{ label: copy.goToSite, action: "link" as const, target: config.appOrigin }],
  };
}
