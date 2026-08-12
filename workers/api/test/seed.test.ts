// SPDX-License-Identifier: MIT
// Session 18 — the named DEV-SEED regression (ADR-0036 F3).
//
// The dev seed writes money-state by hand to give local UI work something to look at (ADR-0021 says
// only the indexer may do that in production — the seed is the deliberate exception). That is fine
// until the fabricated rows claim `onchain_id`s a REAL escrow also issues. They used to claim '1' and
// '2' on chain 84532, and on the live Base Sepolia run the indexer's write for the escrow's actual
// question #1 hit `UNIQUE constraint failed: questions.chain_id, questions.onchain_id`. The question
// stayed `pending_payment` with the asker's USDC already escrowed — it looked exactly like an indexer
// bug and was fixture data squatting on live ids.
//
// So: the real seed file is applied to a real D1 here, and then the indexer's write is replayed for
// every id a deployed escrow will plausibly ever reach. Nothing may collide.

import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import seedSql from "../seed/seed.dev.sql?raw";

/** The escrow's `nextId` starts at 1 and increments per question, so low ids are the reachable ones. */
const REACHABLE_IDS = 64;
/** Nothing real gets within astronomical distance of this; every seeded id must sit above it. */
const OUT_OF_REACH = 10n ** 30n;
/** The three fixture questions the seed fabricates (q1 answered, q2 open, q3 an unpaid draft). */
const SEEDED_UUIDS = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
] as const;

/**
 * Split the seed into executable statements. D1's `exec()` needs one statement per line, which the seed
 * (deliberately readable) is not — so strip the `--` line comments and split on `;`. Safe here because
 * the seed has no `--` or `;` inside a string literal.
 */
function statements(sql: string): string[] {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

interface SeededQuestion {
  id: string;
  onchain_id: string | null;
}

beforeAll(async () => {
  for (const sql of statements(seedSql)) await env.DB.prepare(sql).run();
});

/** Replay what the indexer does when it sees an `AskCreated` for on-chain question `onchainId`. */
async function indexerWrite(onchainId: bigint): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO questions
       (id, chain_id, onchain_id, asker_wallet, answerer_wallet, amount_usdc, body, status, answer_deadline)
     VALUES (?, 84532, ?, ?, ?, '1000000', 'a real question, paid on a real chain', 'open', ?)`,
  )
    .bind(
      `eeeeeeee-eeee-4eee-8eee-${onchainId.toString().padStart(12, "0").slice(-12)}`,
      onchainId.toString(),
      "0x3333333333333333333333333333333333333333",
      "0x1111111111111111111111111111111111111111",
      1_800_000_000,
    )
    .run();
}

describe("regression: the dev seed never squats on a real on-chain id", () => {
  it("applies cleanly and fabricates exactly the three fixture questions", async () => {
    const { results } = await env.DB.prepare(
      "SELECT id, onchain_id FROM questions ORDER BY id",
    ).all<SeededQuestion>();
    expect(results).toHaveLength(3);
    // The third fixture is a pre-payment draft: no on-chain id at all, so it can never collide.
    expect(results.filter((q) => q.onchain_id === null)).toHaveLength(1);
  });

  it("leaves every id a deployed escrow can actually issue free for the indexer", async () => {
    // With the old seed this threw on id 1 — and a paid question was stranded at `pending_payment`.
    for (let id = 1n; id <= BigInt(REACHABLE_IDS); id++) {
      await expect(indexerWrite(id)).resolves.not.toThrow();
    }
    const { results } = await env.DB.prepare(
      "SELECT id, onchain_id FROM questions WHERE onchain_id = '1'",
    ).all<SeededQuestion>();
    expect(results).toHaveLength(1);
    expect(results[0]?.id).not.toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("keeps the fabricated ids out of reach, and still inside the schema's CHECK", async () => {
    const { results } = await env.DB.prepare(
      `SELECT id, onchain_id FROM questions
       WHERE id IN (?, ?, ?) AND onchain_id IS NOT NULL`,
    )
      .bind(...SEEDED_UUIDS)
      .all<SeededQuestion>();
    expect(results).toHaveLength(2);
    for (const q of results) {
      const onchainId = q.onchain_id as string;
      // `questions_onchain_id`: digits only, length 1–39.
      expect(onchainId).toMatch(/^[0-9]{1,39}$/);
      expect(BigInt(onchainId)).toBeGreaterThan(OUT_OF_REACH);
    }
  });

  it("still refuses a genuine duplicate — the unique index itself is untouched", async () => {
    await indexerWrite(9_000n);
    await expect(indexerWrite(9_000n)).rejects.toThrow(/UNIQUE constraint failed/i);
  });
});
