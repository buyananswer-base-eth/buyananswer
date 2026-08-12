// SPDX-License-Identifier: MIT
// Test helpers: a mocked ChainReader (no live RPC) + D1 seeding/reading via the real Drizzle client
// against the Miniflare `env.DB`. Tests seed a `pending_payment` question the way the Session-7 API
// would, then drive reconcile with scripted events and assert the money-state D1 writes.

import { env } from "cloudflare:test";
import { answers, creators, indexerCursor, questions, uuidToRef } from "@buyananswer/shared";
import { and, eq } from "drizzle-orm";
import type { ChainReader } from "../src/chain.js";
import { getDb } from "../src/db.js";
import type { IndexerConfig } from "../src/env.js";
import type { EscrowEvent, QuestionAskedEvent, QuestionSettledEvent } from "../src/events.js";

type Hex = `0x${string}`;

export const ASKER: Hex = "0x1111111111111111111111111111111111111111";
export const ANSWERER: Hex = "0x2222222222222222222222222222222222222222";

/** A synthetic contract address for the cursor — distinct from the migration-seeded Base Sepolia row,
 *  so tests start from `startBlock` and use small block numbers. */
export const TEST_CONTRACT: Hex = "0x00000000000000000000000000000000000000aa";

/** A test IndexerConfig: real chain id (matches seeded questions), synthetic contract, block 0 floor. */
export function testConfig(over: Partial<IndexerConfig> = {}): IndexerConfig {
  return {
    chainId: 84532,
    contractAddress: TEST_CONTRACT,
    startBlock: 0,
    confirmations: 5,
    getLogsRange: 2000,
    maxBlocksPerRun: 100_000,
    rpcUrl: undefined,
    ...over,
  };
}

export function db() {
  return getDb(env);
}

/** A fixed clock for deterministic `revealed_at`/`updated_at` assertions. */
export const FIXED_NOW = new Date("2026-08-11T12:00:00.000Z");
export const fixedClock = () => FIXED_NOW;

// ─── mocked chain ────────────────────────────────────────────────────────────

/** A scripted ChainReader: returns `head` as the finalized head and filters events by block range. */
export class FakeChainReader implements ChainReader {
  head: bigint;
  events: EscrowEvent[];
  readonly getLogsCalls: Array<[bigint, bigint]> = [];

  constructor(head: bigint, events: EscrowEvent[] = []) {
    this.head = head;
    this.events = events;
  }

  async getFinalizedHead(): Promise<bigint> {
    return this.head;
  }

  async getLogs(fromBlock: bigint, toBlock: bigint): Promise<EscrowEvent[]> {
    this.getLogsCalls.push([fromBlock, toBlock]);
    return this.events.filter((e) => e.blockNumber >= fromBlock && e.blockNumber <= toBlock);
  }
}

// ─── event builders ────────────────────────────────────────────────────────────

export function askedEvent(
  uuid: string,
  over: Partial<QuestionAskedEvent> = {},
): QuestionAskedEvent {
  return {
    name: "QuestionAsked",
    ref: uuidToRef(uuid),
    onchainId: 1n,
    asker: ASKER,
    answerer: ANSWERER,
    amount: 2_000_000n,
    deadline: 1_234_567_890n,
    blockNumber: 1n,
    logIndex: 0,
    txHash: "0xasked",
    ...over,
  };
}

export function settledEvent(
  name: QuestionSettledEvent["name"],
  uuid: string,
  over: Partial<QuestionSettledEvent> = {},
): QuestionSettledEvent {
  return {
    name,
    ref: uuidToRef(uuid),
    onchainId: 1n,
    blockNumber: 2n,
    logIndex: 0,
    txHash: `0x${name.toLowerCase()}`,
    ...over,
  };
}

/** An event whose ref doesn't correspond to any seeded question (or is non-conforming). */
export function unknownRefAsked(over: Partial<QuestionAskedEvent> = {}): QuestionAskedEvent {
  // A random UUID that was never inserted as a question.
  return askedEvent(crypto.randomUUID(), over);
}

// ─── D1 seeding + reading ──────────────────────────────────────────────────────

export async function seedCreator(wallet: Hex, handle: string, minPriceUsdc = "1000000") {
  await db().insert(creators).values({ wallet, handle, displayName: handle, minPriceUsdc });
}

/** Seed a `pending_payment` question exactly as the API would (no money-state set). Returns its id. */
export async function seedQuestion(
  over: { id?: string; chainId?: number; asker?: Hex; answerer?: Hex; body?: string } = {},
) {
  const id = over.id ?? crypto.randomUUID();
  await db()
    .insert(questions)
    .values({
      id,
      chainId: over.chainId ?? 84532,
      askerWallet: over.asker ?? ASKER,
      answererWallet: over.answerer ?? ANSWERER,
      body: over.body ?? "why is the sky blue?",
    });
  return id;
}

/** Seed a hidden answer draft (revealed_at null), as the answerer would via the API. */
export async function seedAnswer(questionId: string, body = "because rayleigh scattering") {
  await db().insert(answers).values({ questionId, body });
}

export async function getQuestion(id: string) {
  return db().select().from(questions).where(eq(questions.id, id)).get();
}

export async function getAnswer(questionId: string) {
  return db().select().from(answers).where(eq(answers.questionId, questionId)).get();
}

export async function getCursor(chainId: number, contractAddress: Hex) {
  return db()
    .select()
    .from(indexerCursor)
    .where(
      and(eq(indexerCursor.chainId, chainId), eq(indexerCursor.contractAddress, contractAddress)),
    )
    .get();
}

/** Drop the cursor row so a re-run re-scans the same range — simulates a crash before the cursor
 *  advanced. The state writes must still be idempotent (CAS transition guards). */
export async function resetCursor(config: IndexerConfig) {
  await db()
    .delete(indexerCursor)
    .where(
      and(
        eq(indexerCursor.chainId, config.chainId),
        eq(indexerCursor.contractAddress, config.contractAddress),
      ),
    );
}
