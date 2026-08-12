// SPDX-License-Identifier: MIT
// The escrow events the indexer cares about, normalized into a small discriminated union that the
// reconcile core consumes — decoupled from viem's generic log types so it stays trivially testable.
//
// Every event carries `ref` (the bytes32 UUID) and `id` (the incremental on-chain question id). The
// event → off-chain status mapping is derived from the SHARED `CONTRACT_STATUS_TO_QUESTION_STATUS`
// table (the contract's `Status` enum, CONTRACT_SPEC §2), so the two never drift.

import {
  CONTRACT_STATUS_TO_QUESTION_STATUS,
  type QuestionStatus,
  buyAnAnswerEscrowAbi,
} from "@buyananswer/shared";
import type { AbiEvent } from "viem";

/** A 0x-prefixed hex string. */
type Hex = `0x${string}`;

/** The five escrow events that drive a money-state transition (FUNCTIONAL_SPEC §6, §7). */
export const INDEXED_EVENT_NAMES = [
  "QuestionAsked",
  "QuestionAnswered",
  "QuestionDeclined",
  "QuestionCancelled",
  "QuestionReclaimed",
] as const;
export type IndexedEventName = (typeof INDEXED_EVENT_NAMES)[number];

/**
 * Each event's corresponding contract `Status` enum index (CONTRACT_SPEC §2):
 * `1=Open, 2=Answered, 3=Declined, 4=Cancelled, 5=Reclaimed`. The off-chain target status is then
 * looked up in the shared `CONTRACT_STATUS_TO_QUESTION_STATUS` — one source of truth, no duplicated map.
 */
const EVENT_TO_STATUS_INDEX: Record<IndexedEventName, number> = {
  QuestionAsked: 1,
  QuestionAnswered: 2,
  QuestionDeclined: 3,
  QuestionCancelled: 4,
  QuestionReclaimed: 5,
};

/** The off-chain {@link QuestionStatus} an event transitions a question to. Never null for our events. */
export function statusForEvent(name: IndexedEventName): QuestionStatus {
  const status = CONTRACT_STATUS_TO_QUESTION_STATUS[EVENT_TO_STATUS_INDEX[name]];
  // Our five events map to indices 1..5, all non-null; this is a defensive assertion, not a live path.
  if (status == null) throw new Error(`no off-chain status for event ${name}`);
  return status;
}

/** ABI fragments (viem `AbiEvent[]`) for the indexed events — passed to `getLogs({ events })`. */
export const escrowEventAbis: AbiEvent[] = buyAnAnswerEscrowAbi.filter(
  (item) => item.type === "event" && (INDEXED_EVENT_NAMES as readonly string[]).includes(item.name),
) as unknown as AbiEvent[];

/** Fields common to every normalized event: the on-chain identity + where the log lives. */
export interface BaseEscrowEvent {
  /** The bytes32 UUID linking this on-chain question to `questions.id`. Lowercase hex. */
  readonly ref: Hex;
  /** Incremental on-chain question id (uint256). */
  readonly onchainId: bigint;
  readonly blockNumber: bigint;
  readonly logIndex: number;
  readonly txHash: Hex;
}

/** `QuestionAsked` — the only event that carries the escrow terms (amount, deadline, parties). */
export interface QuestionAskedEvent extends BaseEscrowEvent {
  readonly name: "QuestionAsked";
  readonly asker: Hex;
  readonly answerer: Hex;
  /** Escrowed USDC amount (uint128 base units). */
  readonly amount: bigint;
  /** Answer deadline (uint64 unix seconds) = open time + window. */
  readonly deadline: bigint;
}

/** A settle event (`Answered/Declined/Cancelled/Reclaimed`) — id + ref only. */
export interface QuestionSettledEvent extends BaseEscrowEvent {
  readonly name:
    | "QuestionAnswered"
    | "QuestionDeclined"
    | "QuestionCancelled"
    | "QuestionReclaimed";
}

export type EscrowEvent = QuestionAskedEvent | QuestionSettledEvent;

/** A raw decoded log as produced by viem's `getLogs({ events })` (narrowed to what we read). */
export interface RawEscrowLog {
  eventName?: string;
  args?: Record<string, unknown>;
  blockNumber?: bigint | null;
  logIndex?: number | null;
  transactionHash?: Hex | null;
}

function reqHex(v: unknown): Hex {
  return String(v).toLowerCase() as Hex;
}

/**
 * Normalize a raw viem log into an {@link EscrowEvent}, or `null` if it isn't one of our events or is
 * still pending (no block/log index/tx hash — never index an unmined log). Pure + viem-agnostic so it
 * can be unit-tested with hand-built inputs.
 */
export function normalizeLog(raw: RawEscrowLog): EscrowEvent | null {
  const name = raw.eventName;
  if (!name || !(INDEXED_EVENT_NAMES as readonly string[]).includes(name)) return null;
  const args = raw.args ?? {};
  if (
    raw.blockNumber == null ||
    raw.logIndex == null ||
    raw.transactionHash == null ||
    args.ref == null ||
    args.id == null
  ) {
    return null;
  }

  const base: BaseEscrowEvent = {
    ref: reqHex(args.ref),
    onchainId: BigInt(args.id as bigint),
    blockNumber: raw.blockNumber,
    logIndex: raw.logIndex,
    txHash: raw.transactionHash,
  };

  if (name === "QuestionAsked") {
    if (
      args.asker == null ||
      args.answerer == null ||
      args.amount == null ||
      args.deadline == null
    ) {
      return null;
    }
    return {
      ...base,
      name: "QuestionAsked",
      asker: reqHex(args.asker),
      answerer: reqHex(args.answerer),
      amount: BigInt(args.amount as bigint),
      deadline: BigInt(args.deadline as bigint),
    };
  }
  return { ...base, name: name as QuestionSettledEvent["name"] };
}

/** Ascending (blockNumber, logIndex) — the order events must be applied in (ask before settle). */
export function byBlockThenLog(a: EscrowEvent, b: EscrowEvent): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  return a.logIndex - b.logIndex;
}
