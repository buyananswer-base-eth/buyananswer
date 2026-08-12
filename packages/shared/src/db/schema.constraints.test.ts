// SPDX-License-Identifier: MIT
// Proves the D1 schema's key constraints against a real (in-memory) SQLite engine, applying the
// exact migration SQL that wrangler ships to D1. Covers the two uniqueness guarantees the product
// depends on (FUNCTIONAL_SPEC §3): one handle per creator, one on-chain question per (chain, id),
// plus the indexer_cursor seed and the status CHECK.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { creators, indexerCursor, questions } from "./schema.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

/** Apply every generated migration (in filename order) to a fresh in-memory DB with FKs enforced. */
function freshDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    // `--> statement-breakpoint` markers are SQL line comments, so exec() runs the whole file.
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  return { db: drizzle(sqlite, { schema: { creators, questions, indexerCursor } }), sqlite };
}

const addr = (hex: string) => `0x${hex.padStart(40, "0")}` as const;
const ALICE = addr("a11ce");
const ASKER = addr("a5ce4");

describe("D1 schema constraints", () => {
  let db: ReturnType<typeof freshDb>["db"];

  beforeEach(() => {
    db = freshDb().db;
  });

  it("rejects a duplicate handle (unique index)", () => {
    db.insert(creators)
      .values({ wallet: ALICE, handle: "alice", displayName: "Alice", minPriceUsdc: "5000000" })
      .run();

    expect(() =>
      db
        .insert(creators)
        // different wallet, SAME handle → must violate creators_handle_unique
        .values({
          wallet: addr("b0b"),
          handle: "alice",
          displayName: "Bob",
          minPriceUsdc: "5000000",
        })
        .run(),
    ).toThrow(/UNIQUE constraint failed/i);
  });

  it("rejects a duplicate (chain_id, onchain_id) (unique index)", () => {
    db.insert(creators)
      .values({ wallet: ALICE, handle: "alice", displayName: "Alice", minPriceUsdc: "5000000" })
      .run();
    const base = {
      chainId: 84532,
      onchainId: "1",
      askerWallet: ASKER,
      answererWallet: ALICE,
      body: "first question",
    };
    db.insert(questions)
      .values({ id: "11111111-1111-4111-8111-111111111111", ...base })
      .run();

    expect(() =>
      db
        .insert(questions)
        // different UUID, SAME (chain_id, onchain_id) → must violate questions_chain_onchain_unique
        .values({ id: "22222222-2222-4222-8222-222222222222", ...base })
        .run(),
    ).toThrow(/UNIQUE constraint failed/i);
  });

  it("allows many pending rows with a null onchain_id (NULLs are distinct)", () => {
    db.insert(creators)
      .values({ wallet: ALICE, handle: "alice", displayName: "Alice", minPriceUsdc: "5000000" })
      .run();
    const row = (id: string) => ({
      id,
      chainId: 84532,
      askerWallet: ASKER,
      answererWallet: ALICE,
      body: "pending",
    });
    db.insert(questions).values(row("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).run();
    expect(() =>
      db.insert(questions).values(row("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).run(),
    ).not.toThrow();
  });

  it("rejects a status outside the allowed set (CHECK)", () => {
    db.insert(creators)
      .values({ wallet: ALICE, handle: "alice", displayName: "Alice", minPriceUsdc: "5000000" })
      .run();
    expect(() =>
      db
        .insert(questions)
        .values({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          chainId: 84532,
          askerWallet: ASKER,
          answererWallet: ALICE,
          body: "q",
          // biome-ignore lint/suspicious/noExplicitAny: deliberately bypassing the type to test the DB CHECK
          status: "bogus" as any,
        })
        .run(),
    ).toThrow(/CHECK constraint failed/i);
  });

  it("rejects a question whose answerer is not a creator (foreign key)", () => {
    expect(() =>
      db
        .insert(questions)
        .values({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          chainId: 84532,
          askerWallet: ASKER,
          answererWallet: addr("dead"), // no such creator
          body: "q",
        })
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/i);
  });

  it("seeds the Base Sepolia indexer_cursor at the deploy block", () => {
    const rows = db.select().from(indexerCursor).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      chainId: 84532,
      contractAddress: "0x40a4bfec9441752bcabbd4b3939503671c8724db",
      lastBlock: 45351822,
    });
  });
});
