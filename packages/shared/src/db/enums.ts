// SPDX-License-Identifier: MIT
// Cross-cutting value types + enums for the data model. Kept free of any `drizzle-orm`
// import so both the schema (which needs the CHECK-constraint list) and downstream
// consumers (workers, web, sdk) can depend on it without pulling the ORM.

/**
 * USDC amount as **base units** (6 decimals) held in a base-10 integer string — e.g. `"5000000"`
 * is 5 USDC. Money is never a float and never a JS `number`: on-chain amounts are `uint128`, which
 * can exceed `Number.MAX_SAFE_INTEGER`, and D1's JSON wire format would silently lose precision.
 * Parse with `BigInt(value)` when you need arithmetic. (ADR-0021, ADR-0005.)
 */
export type UsdcBaseUnits = string;

/**
 * Off-chain question status. The lifecycle (FUNCTIONAL_SPEC §5):
 *   pending_payment → open → answered | declined | cancelled | reclaimed
 *
 * `pending_payment` is the only status the API writes (at compose time). Every money-affecting
 * transition (`open` and the four terminal states) is written **exclusively by the indexer**
 * (Session 8) from on-chain events — chain is the source of truth for money. (ADR-0021.)
 */
export const QUESTION_STATUSES = [
  "pending_payment",
  "open",
  "answered",
  "declined",
  "cancelled",
  "reclaimed",
] as const;

export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

/** The subset of statuses that only the indexer may write (all except the API's `pending_payment`). */
export const INDEXER_WRITTEN_STATUSES = [
  "open",
  "answered",
  "declined",
  "cancelled",
  "reclaimed",
] as const satisfies readonly QuestionStatus[];

/**
 * The contract's on-chain `Status` enum (`IBuyAnAnswerEscrow`), by index:
 * `0=None, 1=Open, 2=Answered, 3=Declined, 4=Cancelled, 5=Reclaimed` (CONTRACT_SPEC §2).
 * Index 0 (`None`) has no off-chain row — a question is `pending_payment` until its `QuestionAsked`
 * event is indexed. The indexer uses this to map an event's status to a {@link QuestionStatus}.
 */
export const CONTRACT_STATUS_TO_QUESTION_STATUS = [
  null, // 0 None — id never created on-chain
  "open", // 1 Open
  "answered", // 2 Answered
  "declined", // 3 Declined
  "cancelled", // 4 Cancelled
  "reclaimed", // 5 Reclaimed
] as const satisfies readonly (QuestionStatus | null)[];
