// SPDX-License-Identifier: MIT
// Session 15 — the named PAYWALL regression (the API/UI half of the contract↔indexer↔UI seam).
//
// The golden rule under test: an asker can never read a hidden answer until the on-chain answer is
// INDEXED (`status → answered`, `revealed_at` set) — and that transition is the INDEXER's alone. The
// API exposes no route that opens the paywall, so a client cannot force a reveal by any request. The
// answerer, by contrast, can always read their own draft. This complements the indexer-side integration
// test (workers/indexer/test/integration.test.ts) which proves the indexer WRITES that state; here we
// prove the API READS it exactly. (Session 7 / ADR-0023; FUNCTIONAL_SPEC §3.3, §9.)

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ALICE_PK, BOB_PK, login, postJson, readBody, request } from "./helpers.js";

// A third EOA — a participant in nothing, used to prove the no-existence-leak guard.
const CAROL_PK = "0x0000000000000000000000000000000000000000000000000000000000000005" as const;

async function claim(pk: `0x${string}`, handle: string, minPriceUsdc = "1000000") {
  const session = await login(pk);
  const res = await postJson("/handle/claim", { handle, minPriceUsdc }, session.cookie);
  expect(res.status).toBe(201);
  return session;
}

async function ask(cookie: string, handle: string, amountUsdc = "1000000") {
  const res = await postJson(
    "/questions",
    { handle, amountUsdc, body: "why is the sky blue?" },
    cookie,
  );
  expect(res.status).toBe(201);
  return (await readBody<{ id: string }>(res)).id;
}

/** Simulate the indexer writing money-state (and, on `answered`, the reveal). The API must NEVER do
 *  this — which is exactly why the test does it by hand, straight against D1. Mirrors reconcile.ts. */
async function seedIndexed(id: string, status: "open" | "answered") {
  await env.DB.prepare(
    "UPDATE questions SET status = ?, onchain_id = ?, amount_usdc = ?, answer_deadline = ? WHERE id = ?",
  )
    .bind(status, "1", "1000000", 1_760_000_000, id)
    .run();
  if (status === "answered") {
    await env.DB.prepare("UPDATE answers SET revealed_at = ? WHERE question_id = ?")
      .bind(Math.floor(Date.now() / 1000), id)
      .run();
  }
}

/** Read the asker's gated view of the answer sub-object. */
async function askerAnswerView(id: string, cookie: string) {
  const res = await request(`/questions/${id}`, {}, cookie);
  const { answer, question } = await readBody<{
    answer: Record<string, unknown> | null;
    question: Record<string, unknown>;
  }>(res);
  return { answer, question };
}

describe("regression: answer paywall keys ONLY on the indexer-written status", () => {
  it("the asker cannot read a hidden answer until the indexer writes `answered`", async () => {
    const alice = await claim(ALICE_PK, "alice");
    const bob = await login(BOB_PK);
    const id = await ask(bob.cookie, "alice");

    // Indexer opens the question; the creator drafts the (hidden) answer.
    await seedIndexed(id, "open");
    const draft = await postJson(
      `/questions/${id}/answer`,
      { body: "because Rayleigh scattering" },
      alice.cookie,
    );
    expect(draft.status).toBe(200);

    // While `open`: the asker sees an answer EXISTS but it is locked — no body leaks.
    const beforeAsker = await askerAnswerView(id, bob.cookie);
    expect(beforeAsker.question.status).toBe("open");
    expect(beforeAsker.answer?.locked).toBe(true);
    expect(beforeAsker.answer).not.toHaveProperty("body");

    // The answerer always reads their own draft, paywall or not.
    const aliceView = await askerAnswerView(id, alice.cookie);
    expect(aliceView.answer?.locked).toBe(false);
    expect(aliceView.answer?.body).toBe("because Rayleigh scattering");

    // The indexer marks it `answered` (+ stamps revealed_at) → the paywall opens for the asker.
    await seedIndexed(id, "answered");
    const afterAsker = await askerAnswerView(id, bob.cookie);
    expect(afterAsker.question.status).toBe("answered");
    expect(afterAsker.answer?.locked).toBe(false);
    expect(afterAsker.answer?.body).toBe("because Rayleigh scattering");
    expect(afterAsker.answer?.revealedAt).not.toBeNull();
  });

  it("a client cannot force the reveal — no request opens the paywall, only the indexed status does", async () => {
    const alice = await claim(ALICE_PK, "alice");
    const bob = await login(BOB_PK);
    // The asker even tries to smuggle money-state into the ask; zod strips it, so it opens nothing.
    const res = await postJson(
      "/questions",
      { handle: "alice", amountUsdc: "1000000", body: "q", status: "answered", revealedAt: 123 },
      bob.cookie,
    );
    expect(res.status).toBe(201);
    const id = (await readBody<{ id: string }>(res)).id;

    await seedIndexed(id, "open");
    await postJson(`/questions/${id}/answer`, { body: "secret" }, alice.cookie);

    // The asker POSTs an answer edit carrying `status`/`revealedAt` — rejected as not-the-answerer, and
    // even so it could never open the paywall. The question is still `open`; the body stays hidden.
    const forced = await postJson(
      `/questions/${id}/answer`,
      { body: "x", status: "answered", revealedAt: 999 },
      bob.cookie,
    );
    expect(forced.status).toBe(403); // asker is not the answerer

    const view = await askerAnswerView(id, bob.cookie);
    expect(view.question.status).toBe("open"); // never advanced by an API write
    expect(view.answer?.locked).toBe(true);
    expect(view.answer).not.toHaveProperty("body");
  });

  it("a non-participant cannot even confirm the question exists (no existence leak)", async () => {
    await claim(ALICE_PK, "alice");
    const bob = await login(BOB_PK);
    const carol = await login(CAROL_PK);
    const id = await ask(bob.cookie, "alice");

    const res = await request(`/questions/${id}`, {}, carol.cookie);
    expect(res.status).toBe(404);
  });
});
