// SPDX-License-Identifier: MIT
// Question lifecycle + the server-side answer paywall. These tests prove the golden rules for this
// session: the API never writes a money-state column, the asker cannot read a hidden answer until the
// on-chain answer is INDEXED (status → `answered`, which the tests seed directly the way the indexer
// would), only the answerer can submit/publish, and every read is own-rows-only.

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ALICE_PK, BOB_PK, login, postJson, readBody, request } from "./helpers.js";

// A third EOA (never a creator, never a participant) for non-participant checks. Deterministic key.
const CAROL_PK = "0x0000000000000000000000000000000000000000000000000000000000000005" as const;

/** Claim a creator profile for `pk` and return { cookie, address }. */
async function claim(pk: `0x${string}`, handle: string, minPriceUsdc?: string) {
  const session = await login(pk);
  const res = await postJson("/handle/claim", { handle, minPriceUsdc }, session.cookie);
  expect(res.status).toBe(201);
  return session;
}

/** Ask `handle` a question. Returns the created question id (after asserting 201). */
async function ask(
  cookie: string,
  handle: string,
  amountUsdc: string,
  body = "why is the sky blue?",
) {
  const res = await postJson("/questions", { handle, amountUsdc, body }, cookie);
  expect(res.status).toBe(201);
  return (await readBody<{ id: string }>(res)).id;
}

/**
 * Simulate the indexer writing money-state onto a question (and, when answered, the reveal). The API
 * must NEVER do this — that's exactly why the tests do it by hand.
 */
async function seedIndexed(
  id: string,
  fields: { status: string; onchainId: string; amountUsdc: string; answerDeadline?: number },
) {
  await env.DB.prepare(
    "UPDATE questions SET status = ?, onchain_id = ?, amount_usdc = ?, answer_deadline = ? WHERE id = ?",
  )
    .bind(fields.status, fields.onchainId, fields.amountUsdc, fields.answerDeadline ?? null, id)
    .run();
  if (fields.status === "answered") {
    await env.DB.prepare("UPDATE answers SET revealed_at = ? WHERE question_id = ?")
      .bind(Math.floor(Date.now() / 1000), id)
      .run();
  }
}

describe("POST /questions", () => {
  it("creates a pending_payment row, returns { id }, and never sets money-state", async () => {
    await claim(ALICE_PK, "alice", "1000000");
    const asker = await login(BOB_PK);

    // Even if a malicious client sends money-state fields, zod strips them and they're never written.
    const res = await postJson(
      "/questions",
      {
        handle: "alice",
        amountUsdc: "2000000",
        body: "how do escrows work?",
        status: "answered",
        onchainId: "99",
        answerDeadline: 999,
        isPublic: true,
      },
      asker.cookie,
    );
    expect(res.status).toBe(201);
    const { id } = await readBody<{ id: string }>(res);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const detail = await request(`/questions/${id}`, {}, asker.cookie);
    const { question } = await readBody<{ question: Record<string, unknown> }>(detail);
    expect(question.status).toBe("pending_payment");
    expect(question.onchainId).toBeNull();
    expect(question.amountUsdc).toBeNull();
    expect(question.answerDeadline).toBeNull();
    expect(question.isPublic).toBe(false);
    expect(question.askerWallet).toBe(asker.address);
  });

  it("enforces amount ≥ the creator's min price at ask time", async () => {
    await claim(ALICE_PK, "alice", "5000000"); // 5 USDC minimum
    const asker = await login(BOB_PK);

    const tooLow = await postJson(
      "/questions",
      { handle: "alice", amountUsdc: "4000000", body: "cheapskate question" },
      asker.cookie,
    );
    expect(tooLow.status).toBe(422);
    expect((await readBody(tooLow)).error).toBe("amount_below_min");

    // Exactly the minimum is allowed.
    const ok = await postJson(
      "/questions",
      { handle: "alice", amountUsdc: "5000000", body: "fair question" },
      asker.cookie,
    );
    expect(ok.status).toBe(201);
  });

  it("404s when the target creator handle doesn't exist", async () => {
    const asker = await login(BOB_PK);
    const res = await postJson(
      "/questions",
      { handle: "ghost", amountUsdc: "5000000", body: "anyone home?" },
      asker.cookie,
    );
    expect(res.status).toBe(404);
    expect((await readBody(res)).error).toBe("answerer_not_found");
  });

  it("requires a session", async () => {
    const res = await postJson("/questions", {
      handle: "alice",
      amountUsdc: "5000000",
      body: "anon ask",
    });
    expect(res.status).toBe(401);
  });

  it("422s an unsupported chain id", async () => {
    await claim(ALICE_PK, "alice", "1000000");
    const asker = await login(BOB_PK);
    const res = await postJson(
      "/questions",
      { handle: "alice", amountUsdc: "1000000", body: "wrong chain", chainId: 1 },
      asker.cookie,
    );
    expect(res.status).toBe(422);
    expect((await readBody(res)).error).toBe("unsupported_chain");
  });
});

describe("answer paywall — GET /questions/:id", () => {
  it("hides the answer body from the asker until answered; the answerer always sees it", async () => {
    const alice = await claim(ALICE_PK, "alice", "1000000");
    const bob = await login(BOB_PK);
    const id = await ask(bob.cookie, "alice", "1000000");

    // Indexer opens the question; the creator writes the hidden answer.
    await seedIndexed(id, { status: "open", onchainId: "1", amountUsdc: "1000000" });
    const answered = await postJson(
      `/questions/${id}/answer`,
      { body: "because Rayleigh scattering" },
      alice.cookie,
    );
    expect(answered.status).toBe(200);

    // Asker: answer present but locked, no body, while still `open`.
    const bobBefore = await request(`/questions/${id}`, {}, bob.cookie);
    const bobBody = await readBody<{ answer: Record<string, unknown> }>(bobBefore);
    expect(bobBody.answer.locked).toBe(true);
    expect(bobBody.answer).not.toHaveProperty("body");

    // Answerer: can always read their own draft.
    const aliceView = await request(`/questions/${id}`, {}, alice.cookie);
    const aliceBody = await readBody<{ answer: Record<string, unknown> }>(aliceView);
    expect(aliceBody.answer.locked).toBe(false);
    expect(aliceBody.answer.body).toBe("because Rayleigh scattering");

    // Indexer marks it answered → the paywall opens for the asker too.
    await seedIndexed(id, { status: "answered", onchainId: "1", amountUsdc: "1000000" });
    const bobAfter = await request(`/questions/${id}`, {}, bob.cookie);
    const afterBody = await readBody<{
      answer: Record<string, unknown>;
      question: Record<string, unknown>;
    }>(bobAfter);
    expect(afterBody.question.status).toBe("answered");
    expect(afterBody.answer.locked).toBe(false);
    expect(afterBody.answer.body).toBe("because Rayleigh scattering");
    expect(afterBody.answer.revealedAt).not.toBeNull();
  });

  it("404s a non-participant (no existence leak)", async () => {
    await claim(ALICE_PK, "alice", "1000000");
    const bob = await login(BOB_PK);
    const carol = await login(CAROL_PK);
    const id = await ask(bob.cookie, "alice", "1000000");

    const res = await request(`/questions/${id}`, {}, carol.cookie);
    expect(res.status).toBe(404);
  });
});

describe("POST /questions/:id/answer", () => {
  it("lets only the answerer submit", async () => {
    await claim(ALICE_PK, "alice", "1000000");
    const bob = await login(BOB_PK);
    const carol = await login(CAROL_PK);
    const id = await ask(bob.cookie, "alice", "1000000");

    // The asker is a participant but not the answerer → 403.
    const askerTry = await postJson(`/questions/${id}/answer`, { body: "sneaky" }, bob.cookie);
    expect(askerTry.status).toBe(403);
    expect((await readBody(askerTry)).error).toBe("not_answerer");

    // A non-participant → 404.
    const strangerTry = await postJson(`/questions/${id}/answer`, { body: "nope" }, carol.cookie);
    expect(strangerTry.status).toBe(404);
  });

  it("allows re-editing while hidden but locks the answer once answered", async () => {
    const alice = await claim(ALICE_PK, "alice", "1000000");
    const bob = await login(BOB_PK);
    const id = await ask(bob.cookie, "alice", "1000000");
    await seedIndexed(id, { status: "open", onchainId: "1", amountUsdc: "1000000" });

    const first = await postJson(`/questions/${id}/answer`, { body: "first draft" }, alice.cookie);
    expect(first.status).toBe(200);
    const second = await postJson(
      `/questions/${id}/answer`,
      { body: "final answer" },
      alice.cookie,
    );
    expect(second.status).toBe(200);
    expect((await readBody(second)).answer.body).toBe("final answer");

    // Once the indexer reveals it, the body is immutable.
    await seedIndexed(id, { status: "answered", onchainId: "1", amountUsdc: "1000000" });
    const locked = await postJson(`/questions/${id}/answer`, { body: "too late" }, alice.cookie);
    expect(locked.status).toBe(409);
    expect((await readBody(locked)).error).toBe("answer_locked");
  });
});

describe("POST /questions/:id/publish + GET /p/:id", () => {
  it("blocks publish before answered, then lets the answerer publish a public card", async () => {
    const alice = await claim(ALICE_PK, "alice", "1000000");
    const bob = await login(BOB_PK);
    const id = await ask(bob.cookie, "alice", "1000000");
    await seedIndexed(id, { status: "open", onchainId: "1", amountUsdc: "1000000" });
    await postJson(`/questions/${id}/answer`, { body: "the answer" }, alice.cookie);

    // Not answered yet → can't publish, and the public card doesn't exist.
    const early = await postJson(`/questions/${id}/publish`, {}, alice.cookie);
    expect(early.status).toBe(409);
    expect((await readBody(early)).error).toBe("not_answered");
    expect((await request(`/p/${id}`)).status).toBe(404);

    await seedIndexed(id, { status: "answered", onchainId: "1", amountUsdc: "1000000" });

    // The asker cannot publish someone else's card.
    const askerPublish = await postJson(`/questions/${id}/publish`, {}, bob.cookie);
    expect(askerPublish.status).toBe(403);

    // Still private until the creator publishes.
    expect((await request(`/p/${id}`)).status).toBe(404);

    const published = await postJson(`/questions/${id}/publish`, {}, alice.cookie);
    expect(published.status).toBe(200);
    expect((await readBody(published)).question.isPublic).toBe(true);

    const card = await request(`/p/${id}`);
    expect(card.status).toBe(200);
    const cardBody = await readBody<{ answer: { body: string }; creator: { handle: string } }>(
      card,
    );
    expect(cardBody.answer.body).toBe("the answer");
    expect(cardBody.creator.handle).toBe("alice");
  });
});

describe("GET /questions/received | /asked — own rows only + pagination", () => {
  it("scopes each list to the session wallet and paginates newest-first", async () => {
    const alice = await claim(ALICE_PK, "alice", "1000000");
    const bob = await login(BOB_PK);

    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(await ask(bob.cookie, "alice", "1000000", `q${i}`));

    // Alice received all three; Bob asked all three.
    const received = await request("/questions/received", {}, alice.cookie);
    const receivedBody = await readBody<{ questions: { id: string }[]; hasMore: boolean }>(
      received,
    );
    expect(receivedBody.questions).toHaveLength(3);
    expect(new Set(receivedBody.questions.map((q) => q.id))).toEqual(new Set(ids));
    expect(receivedBody.hasMore).toBe(false);

    const asked = await request("/questions/asked", {}, bob.cookie);
    expect((await readBody(asked)).questions).toHaveLength(3);

    // Cross-scope isolation: Bob received nothing; Alice asked nothing.
    expect(
      (await readBody(await request("/questions/received", {}, bob.cookie))).questions,
    ).toHaveLength(0);
    expect(
      (await readBody(await request("/questions/asked", {}, alice.cookie))).questions,
    ).toHaveLength(0);

    // No answer bodies leak in list views, and each carries a hasAnswer flag.
    for (const q of receivedBody.questions) {
      expect(q).not.toHaveProperty("body_answer");
      expect(q).toHaveProperty("hasAnswer", false);
    }

    // Pagination: page 1 (limit 2) has more; page 2 (offset 2) is the tail; ids partition cleanly.
    const p1 = await readBody<{ questions: { id: string; createdAt: number }[]; hasMore: boolean }>(
      await request("/questions/received?limit=2", {}, alice.cookie),
    );
    expect(p1.questions).toHaveLength(2);
    expect(p1.hasMore).toBe(true);
    const p2 = await readBody<{ questions: { id: string }[]; hasMore: boolean }>(
      await request("/questions/received?limit=2&offset=2", {}, alice.cookie),
    );
    expect(p2.questions).toHaveLength(1);
    expect(p2.hasMore).toBe(false);
    expect(new Set([...p1.questions, ...p2.questions].map((q) => q.id))).toEqual(new Set(ids));
  });
});
