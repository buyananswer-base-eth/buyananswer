// SPDX-License-Identifier: MIT
// Answer authoring — the answerer's half of the paywall.
//
//   POST /questions/:id/answer — the answerer saves or replaces the HIDDEN answer body.
//
// The answer is stored while the question is still paywalled; it becomes readable to the asker only
// once the on-chain answer is indexed (status → `answered`, `revealed_at` set) — both of which are
// indexer-only. This route therefore NEVER sets `revealed_at` and refuses to edit once `answered`
// (immutable after reveal in v1; FUNCTIONAL_SPEC §3.3).

import { type NewAnswer, answers, questions } from "@buyananswer/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { requireAuth } from "../auth/middleware.js";
import type { AppContext } from "../env.js";
import { getDb } from "../lib/db.js";
import { ApiError, readJson } from "../lib/http.js";
import { LIMITS, ipLimit } from "../lib/limits.js";
import { presentAnswer } from "../lib/question.js";
import { answerBody } from "../schemas.js";

export const answerRoutes = new Hono<AppContext>();

answerRoutes.post("/questions/:id/answer", ipLimit(LIMITS.answerSave), requireAuth, async (c) => {
  const wallet = c.get("wallet");
  const id = c.req.param("id");
  const body = answerBody.parse(await readJson(c));

  const db = getDb(c.env);
  const question = await db.select().from(questions).where(eq(questions.id, id)).get();
  if (!question) throw new ApiError(404, "not_found");
  // Only the answerer may submit. A participant asker gets a 403; anyone else a 404 (no existence leak).
  if (wallet !== question.answererWallet) {
    if (wallet === question.askerWallet) {
      throw new ApiError(403, "not_answerer", "only the answerer can answer this question");
    }
    throw new ApiError(404, "not_found");
  }
  // Editable only before the on-chain reveal; once `answered` the body is locked.
  if (question.status === "answered") {
    throw new ApiError(409, "answer_locked", "the answer is revealed and can no longer be edited");
  }

  const now = new Date();
  const row: NewAnswer = { questionId: id, body: body.body, submittedAt: now, updatedAt: now };
  // Upsert: first save inserts, later saves replace the body (never touches revealed_at).
  const saved = await db
    .insert(answers)
    .values(row)
    .onConflictDoUpdate({ target: answers.questionId, set: { body: body.body, updatedAt: now } })
    .returning()
    .get();

  c.get("log").audit("answer_save", { wallet, questionId: id });
  // The author can always see their own draft.
  return c.json({ answer: presentAnswer(saved, true) });
});
