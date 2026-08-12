// SPDX-License-Identifier: MIT
// Question lifecycle routes. Authorization is server-side on every mutation and every query is scoped
// to the session wallet — a wallet only ever sees questions it asked or was asked. The API writes ONLY
// the initial `pending_payment` status + content; it never touches a money-state column
// (`onchain_id`/`amount_usdc`/`answer_deadline`/`revealed_at` or a money-affecting status) — those are
// indexer-only (ADR-0021, FUNCTIONAL_SPEC §6, §8).
//
//   POST /questions             — asker composes a question for a creator → mints UUID, returns { id }.
//   GET  /questions/received    — the answerer's inbox (own rows), paginated, newest first.
//   GET  /questions/asked       — the asker's history (own rows), paginated, newest first.
//   GET  /questions/:id         — detail for asker or answerer; answer body gated by the paywall.
//   POST /questions/:id/publish — answerer flips is_public=true, only after `answered`.
//   GET  /p/:id                 — public Q→A card, only when is_public && answered.

import { type Address, type NewQuestion, answers, creators, questions } from "@buyananswer/shared";
import { parseIdempotencyKey, withIdempotency } from "@buyananswer/worker-kit";
import { desc, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { requireAuth } from "../auth/middleware.js";
import { ALLOWED_CHAIN_IDS, type AppContext, DEFAULT_CHAIN_ID } from "../env.js";
import { presentPublicCreator } from "../lib/creator.js";
import { getDb } from "../lib/db.js";
import { ApiError, readJson } from "../lib/http.js";
import { LIMITS, ipLimit } from "../lib/limits.js";
import {
  presentQuestion,
  presentQuestionDetail,
  presentQuestionListItem,
} from "../lib/question.js";
import { createQuestionBody, listQuery } from "../schemas.js";

/** How long an `Idempotency-Key` result is remembered (a client retry within a day returns the same id). */
const IDEMPOTENCY_TTL_SECONDS = 60 * 60 * 24;

export const questionRoutes = new Hono<AppContext>();

// ─── POST /questions ────────────────────────────────────────────────────────
// The asker mints an off-chain draft addressed to a creator. We enforce amount ≥ the creator's min
// price AT ASK TIME, but never persist the amount (indexer-only). The client encodes the returned UUID
// as the on-chain `bytes32 ref` when it pays.
questionRoutes.post("/questions", ipLimit(LIMITS.questionCreate), requireAuth, async (c) => {
  const asker = c.get("wallet");
  const body = createQuestionBody.parse(await readJson(c));

  const chainId = body.chainId ?? DEFAULT_CHAIN_ID;
  if (!ALLOWED_CHAIN_IDS.includes(chainId)) {
    throw new ApiError(422, "unsupported_chain", "unsupported chain id");
  }

  const db = getDb(c.env);
  // The answerer must be a real creator (satisfies the FK) — clean 404 rather than a raw FK failure.
  const creator = await db.select().from(creators).where(eq(creators.handle, body.handle)).get();
  if (!creator) throw new ApiError(404, "answerer_not_found", "no creator with that handle");

  // Min-price gate (base-unit BigInt compare — money is never a JS number).
  if (BigInt(body.amountUsdc) < BigInt(creator.minPriceUsdc)) {
    throw new ApiError(422, "amount_below_min", "amount is below the creator's minimum price");
  }

  // Mint the pending_payment draft. `Idempotency-Key` (optional) makes a client retry return the SAME
  // id instead of double-minting a row for one intended ask (ADR-0032). The insert writes no
  // money-state — the indexer still owns every money-state transition.
  const mint = async (): Promise<{ id: string }> => {
    const row: NewQuestion = {
      id: crypto.randomUUID(),
      chainId,
      askerWallet: asker,
      answererWallet: creator.wallet,
      body: body.body,
      // status defaults to 'pending_payment'; is_public defaults to false. No money-state is set.
    };
    const created = await db.insert(questions).values(row).returning().get();
    return { id: created.id };
  };

  const idemKey = parseIdempotencyKey(c.req.header("Idempotency-Key"));
  const { value, replayed } = idemKey
    ? await withIdempotency(
        c.env.RATELIMIT,
        { scope: asker, key: idemKey, ttlSeconds: IDEMPOTENCY_TTL_SECONDS },
        mint,
      )
    : { value: await mint(), replayed: false };

  c.get("log").audit("question_create", { wallet: asker, questionId: value.id, replayed });
  return c.json(value, 201);
});

// ─── GET /questions/received | /questions/asked ──────────────────────────────
// Own-rows-only inboxes. `received` filters by answerer, `asked` by asker. Both paginate newest-first
// and never carry an answer body (redacted); a `hasAnswer` flag tells the UI a draft exists.
async function listQuestions(
  c: Context<AppContext>,
  column: typeof questions.askerWallet | typeof questions.answererWallet,
) {
  const wallet: Address = c.get("wallet");
  const { limit, offset } = listQuery.parse(c.req.query());

  const rows = await getDb(c.env)
    .select({ question: questions, answerId: answers.questionId })
    .from(questions)
    .leftJoin(answers, eq(answers.questionId, questions.id))
    .where(eq(column, wallet))
    // created_at then id for a stable, deterministic newest-first order.
    .orderBy(desc(questions.createdAt), desc(questions.id))
    .limit(limit + 1)
    .offset(offset)
    .all();

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return c.json({
    questions: page.map((r) => presentQuestionListItem(r.question, r.answerId != null)),
    limit,
    offset,
    hasMore,
  });
}

questionRoutes.get("/questions/received", requireAuth, (c) =>
  listQuestions(c, questions.answererWallet),
);
questionRoutes.get("/questions/asked", requireAuth, (c) => listQuestions(c, questions.askerWallet));

// ─── GET /questions/:id ──────────────────────────────────────────────────────
// Detail for a participant only (asker or answerer). A non-participant gets a 404 — the route never
// confirms a question exists to someone unrelated. The answer body is revealed only when the question
// is `answered` on-chain (indexer-written) OR the requester is the answerer (own draft).
questionRoutes.get("/questions/:id", requireAuth, async (c) => {
  const wallet = c.get("wallet");
  const id = c.req.param("id");

  const db = getDb(c.env);
  const question = await db.select().from(questions).where(eq(questions.id, id)).get();
  if (!question) throw new ApiError(404, "not_found");
  const isAsker = wallet === question.askerWallet;
  const isAnswerer = wallet === question.answererWallet;
  if (!isAsker && !isAnswerer) throw new ApiError(404, "not_found");

  const answer = await db.select().from(answers).where(eq(answers.questionId, id)).get();
  const canSeeAnswerBody = question.status === "answered" || isAnswerer;
  return c.json(presentQuestionDetail(question, answer, canSeeAnswerBody));
});

// ─── POST /questions/:id/publish ─────────────────────────────────────────────
// The answerer (creator) opts a Q→A card into public visibility. Only allowed once the question is
// `answered` (indexer-written), so the reveal has actually happened. Idempotent.
questionRoutes.post(
  "/questions/:id/publish",
  ipLimit(LIMITS.questionPublish),
  requireAuth,
  async (c) => {
    const wallet = c.get("wallet");
    const id = c.req.param("id");

    const db = getDb(c.env);
    const question = await db.select().from(questions).where(eq(questions.id, id)).get();
    if (!question) throw new ApiError(404, "not_found");
    // Non-participant → 404; a participant who isn't the answerer → 403.
    if (wallet !== question.answererWallet) {
      if (wallet === question.askerWallet) {
        throw new ApiError(403, "not_answerer", "only the answerer can publish this card");
      }
      throw new ApiError(404, "not_found");
    }
    if (question.status !== "answered") {
      throw new ApiError(
        409,
        "not_answered",
        "a question can only be published after it is answered",
      );
    }

    const updated = await db
      .update(questions)
      .set({ isPublic: true, updatedAt: new Date() })
      .where(eq(questions.id, id))
      .returning()
      .get();
    c.get("log").audit("question_publish", { wallet, questionId: id });
    return c.json({ question: presentQuestion(updated) });
  },
);

// ─── GET /p/:id ──────────────────────────────────────────────────────────────
// Public Q→A card (the sharing surface). Only exposed when the creator has published it AND it is
// answered. Asker identity is limited to the wallet address (FUNCTIONAL_SPEC §9).
questionRoutes.get("/p/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c.env);
  const question = await db.select().from(questions).where(eq(questions.id, id)).get();
  if (!question || !question.isPublic || question.status !== "answered") {
    throw new ApiError(404, "not_found");
  }
  const answer = await db.select().from(answers).where(eq(answers.questionId, id)).get();
  const creator = await db
    .select()
    .from(creators)
    .where(eq(creators.wallet, question.answererWallet))
    .get();

  return c.json({
    id: question.id,
    body: question.body,
    askerWallet: question.askerWallet,
    amountUsdc: question.amountUsdc,
    answeredAt: answer?.revealedAt ?? null,
    createdAt: question.createdAt,
    answer: answer ? { body: answer.body } : null,
    creator: creator ? presentPublicCreator(creator) : null,
  });
});
