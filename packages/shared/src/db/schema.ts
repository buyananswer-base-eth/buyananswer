// SPDX-License-Identifier: MIT
// Drizzle schema for the BuyAnAnswer D1 (SQLite) database. Single source of truth for tables,
// constraints, and — via `$inferSelect`/`$inferInsert` in ./types.ts — the row types shared by
// workers/*, packages/sdk, and apps/web. Dialect is SQLite (`drizzle-orm/sqlite-core`); D1 is
// SQLite, so this is the correct dialect (never pg/mysql).
//
// PROVENANCE (chain = truth for money — golden rule; ADR-0021):
//   • The API writes ONLY profile + content columns and `questions.status = 'pending_payment'`.
//   • The INDEXER (Session 8) is the SOLE writer of every money-state column, marked
//     `[indexer-only]` below: questions.{onchain_id, amount_usdc, answer_deadline}, the
//     money-affecting `questions.status` transitions (open/answered/declined/cancelled/reclaimed),
//     and answers.revealed_at. Clients never set these (FUNCTIONAL_SPEC §6, §8).
//
// CONVENTIONS:
//   • Addresses are stored lowercase `0x…` (42 chars); CHECKs enforce it (FUNCTIONAL_SPEC §3.1).
//   • USDC amounts are base-unit integer *strings* (text), never floats/numbers (see UsdcBaseUnits).
//   • Timestamps are unix seconds via `integer(mode:'timestamp')`; DB default is `unixepoch()`.

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { Address } from "../contracts/deployments.js";
import { QUESTION_STATUSES, type QuestionStatus, type UsdcBaseUnits } from "./enums.js";

/** CHECK fragment: column holds a lowercase, 0x-prefixed, 42-char EVM address. */
const isAddress = (col: string) =>
  sql.raw(
    `length(${col}) = 42 AND substr(${col}, 1, 2) = '0x' AND substr(${col}, 3) NOT GLOB '*[^0-9a-f]*'`,
  );

/** CHECK fragment: column holds a non-negative base-10 integer string (USDC base units, ≤ uint128). */
const isBaseUnits = (col: string) =>
  sql.raw(`length(${col}) BETWEEN 1 AND 39 AND ${col} NOT GLOB '*[^0-9]*'`);

// ─────────────────────────────────────────────────────────────────────────────
// creators — a claimed profile that can receive paid questions. API-owned.
// ─────────────────────────────────────────────────────────────────────────────
export const creators = sqliteTable(
  "creators",
  {
    /** Wallet address (lowercase). PK; set from SIWE at handle-claim (FUNCTIONAL_SPEC §3.1). */
    wallet: text("wallet").$type<Address>().primaryKey(),
    /** Unique, case-insensitive handle; regex `^[a-z0-9_]{3,30}$` (stored lowercase). */
    handle: text("handle").notNull(),
    /** Public display name, 1–50 chars. */
    displayName: text("display_name").notNull(),
    /** Optional one-line headline, ≤ 80 chars. */
    headline: text("headline"),
    /** Optional bio, ≤ 500 chars. */
    bio: text("bio"),
    /** R2 object URL for the avatar image (≤ 5 MB, png/jpeg/webp) — validated in the API. */
    avatarUrl: text("avatar_url"),
    /** Optional off-site links as a JSON array string, e.g. `'[{"label":"x","url":"…"}]'`. */
    links: text("links"),
    /** Minimum ask price in USDC base units; 1–10,000 USDC (1e6–1e10 base units). */
    minPriceUsdc: text("min_price_usdc").$type<UsdcBaseUnits>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [
    // Unique handle. Handles are always stored lowercase (enforced by `creators_handle_fmt`), so a
    // plain unique index already gives case-insensitive uniqueness.
    uniqueIndex("creators_handle_unique").on(t.handle),
    check("creators_wallet_addr", isAddress("wallet")),
    check(
      "creators_handle_fmt",
      sql`length(${t.handle}) BETWEEN 3 AND 30 AND ${t.handle} NOT GLOB '*[^a-z0-9_]*'`,
    ),
    check("creators_display_name_len", sql`length(${t.displayName}) BETWEEN 1 AND 50`),
    check("creators_headline_len", sql`${t.headline} IS NULL OR length(${t.headline}) <= 80`),
    check("creators_bio_len", sql`${t.bio} IS NULL OR length(${t.bio}) <= 500`),
    // min_price is bounded (≤ 1e10 < 2^63) so a numeric CAST check is safe here.
    check(
      "creators_min_price",
      sql`${isBaseUnits("min_price_usdc")} AND CAST(${t.minPriceUsdc} AS INTEGER) BETWEEN 1000000 AND 10000000000`,
    ),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// questions — one asked question. PK `id` is the UUID the API mints at compose time and IS the
// on-chain `bytes32 ref` (FUNCTIONAL_SPEC §6). Money columns are [indexer-only].
// ─────────────────────────────────────────────────────────────────────────────
export const questions = sqliteTable(
  "questions",
  {
    /** UUIDv4 minted by the API at compose; encoded as the contract `bytes32 ref`. Also the ref key. */
    id: text("id").primaryKey(),
    /** EVM chain id the escrow lives on (dev: 84532 Base Sepolia). */
    chainId: integer("chain_id").notNull(),
    /** [indexer-only] incremental on-chain question id from `QuestionAsked`; null until indexed. */
    onchainId: text("onchain_id"),
    /** Payer's wallet (lowercase). Set by the API at compose from the authed session. */
    askerWallet: text("asker_wallet").$type<Address>().notNull(),
    /** Creator's wallet (lowercase). FK → creators.wallet; the question is addressed to this creator. */
    answererWallet: text("answerer_wallet")
      .$type<Address>()
      .notNull()
      .references(() => creators.wallet, { onDelete: "restrict", onUpdate: "cascade" }),
    /** [indexer-only] escrowed amount in USDC base units, from the on-chain event; null until indexed. */
    amountUsdc: text("amount_usdc").$type<UsdcBaseUnits>(),
    /** Question text, 1–2000 chars. API-written. */
    body: text("body").notNull(),
    /**
     * Lifecycle status. API writes only the initial `pending_payment`; every later transition is
     * [indexer-only] (chain = truth). See QUESTION_STATUSES / CONTRACT_STATUS_TO_QUESTION_STATUS.
     */
    status: text("status").$type<QuestionStatus>().notNull().default("pending_payment"),
    /** [indexer-only] answer deadline (open time + window), from the `QuestionAsked` event; unix seconds. */
    answerDeadline: integer("answer_deadline", { mode: "timestamp" }),
    /** Creator may flip to public after `answered` (FUNCTIONAL_SPEC §9). API-written. */
    isPublic: integer("is_public", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [
    // One off-chain row per on-chain question. `onchain_id` is null until indexed and SQLite treats
    // NULLs as distinct, so many `pending_payment` rows coexist; the constraint bites once indexed.
    uniqueIndex("questions_chain_onchain_unique").on(t.chainId, t.onchainId),
    // Board reads: a creator's received inbox, and an asker's history.
    index("questions_answerer_idx").on(t.answererWallet),
    index("questions_asker_idx").on(t.askerWallet),
    check("questions_asker_addr", isAddress("asker_wallet")),
    check("questions_answerer_addr", isAddress("answerer_wallet")),
    check("questions_chain_id", sql`${t.chainId} > 0`),
    check("questions_onchain_id", sql`${t.onchainId} IS NULL OR ${isBaseUnits("onchain_id")}`),
    check("questions_amount", sql`${t.amountUsdc} IS NULL OR ${isBaseUnits("amount_usdc")}`),
    check("questions_body_len", sql`length(${t.body}) BETWEEN 1 AND 2000`),
    check(
      "questions_status",
      sql.raw(`status IN (${QUESTION_STATUSES.map((s) => `'${s}'`).join(", ")})`),
    ),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// answers — at most one per question (PK == FK). Body is written by the creator while hidden;
// `revealed_at` is [indexer-only], set when the on-chain answer is indexed (paywall reveal).
// ─────────────────────────────────────────────────────────────────────────────
export const answers = sqliteTable(
  "answers",
  {
    /** FK → questions.id, and the PK — enforces exactly one answer per question. */
    questionId: text("question_id")
      .primaryKey()
      .references(() => questions.id, { onDelete: "cascade", onUpdate: "cascade" }),
    /** Answer text, 1–5000 chars. Editable only while hidden (before reveal). API-written. */
    body: text("body").notNull(),
    /** When the creator saved the (hidden) answer. API-written. */
    submittedAt: integer("submitted_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    /** [indexer-only] set when the question becomes `answered` on-chain; null = still paywalled. */
    revealedAt: integer("revealed_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [check("answers_body_len", sql`length(${t.body}) BETWEEN 1 AND 5000`)],
);

// ─────────────────────────────────────────────────────────────────────────────
// indexer_cursor — the indexer's per (chain, contract) backfill/tail position. Seeded with the
// escrow's deploy block so Session 8 backfills from there (see migration 0001 / deployments.ts).
// ─────────────────────────────────────────────────────────────────────────────
export const indexerCursor = sqliteTable(
  "indexer_cursor",
  {
    /** EVM chain id (e.g. 84532 Base Sepolia). */
    chainId: integer("chain_id").notNull(),
    /** Escrow contract address (lowercase). */
    contractAddress: text("contract_address").$type<Address>().notNull(),
    /** Last block the indexer has fully processed; backfill resumes after it. */
    lastBlock: integer("last_block").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.contractAddress] }),
    check("indexer_cursor_addr", isAddress("contract_address")),
    check("indexer_cursor_chain_id", sql`${t.chainId} > 0`),
    check("indexer_cursor_block", sql`${t.lastBlock} >= 0`),
  ],
);
