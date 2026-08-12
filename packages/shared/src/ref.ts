// SPDX-License-Identifier: MIT
// The on-chain ↔ off-chain linking codec (FUNCTIONAL_SPEC §6, normative). A question's identity is a
// v4 UUID minted by the API (`crypto.randomUUID()`), stored as `questions.id`, AND carried on-chain as
// the escrow's `bytes32 ref`. The encoding is: the 16-byte UUID **left-padded** into a 32-byte word
// (the UUID occupies the low 16 bytes; the high 16 bytes are zero).
//
//   uuid  36b8f84d-df4e-4d49-b662-bbfa1046a2b0
//   ref   0x00000000000000000000000000000000 36b8f84ddf4e4d49b662bbfa1046a2b0
//         └──────────── 16 zero bytes ───────┘ └──────────── 16 UUID bytes ───┘
//
// `uuidToRef` is what the client/sdk uses when it calls `askQuestion` (Session 11); `refToUuid` is the
// exact inverse the indexer uses to map a `QuestionAsked.ref` back to `questions.id` (Session 8). They
// are provably round-trip (see ref.test.ts). Kept pure and dependency-free so `@buyananswer/shared`
// stays dep-light and both the browser client and the Worker can share one implementation.

import type { Address } from "./contracts/deployments.js";

/** A 0x-prefixed 32-byte hex string (the on-chain `bytes32 ref`), lowercase. */
export type Ref = `0x${string}`;

/** Canonical lowercase v4-shaped UUID, e.g. `36b8f84d-df4e-4d49-b662-bbfa1046a2b0`. */
export type Uuid = string;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REF_RE = /^0x[0-9a-f]{64}$/;
/** The high 16 bytes of a conforming ref are always zero (the UUID is left-padded). */
const REF_ZERO_HALF = "0".repeat(32);

/** True when `value` is a canonical lowercase UUID (the shape `crypto.randomUUID()` emits). */
export function isUuid(value: string): value is Uuid {
  return UUID_RE.test(value);
}

/**
 * Encode a UUID (`questions.id`) as the on-chain `bytes32 ref`. Inverse of {@link refToUuid}.
 * @throws if `uuid` is not a canonical UUID.
 */
export function uuidToRef(uuid: string): Ref {
  const lower = uuid.toLowerCase();
  if (!isUuid(lower)) {
    throw new Error(`invalid uuid: ${uuid}`);
  }
  return `0x${REF_ZERO_HALF}${lower.replaceAll("-", "")}`;
}

/**
 * Decode an on-chain `bytes32 ref` back to its UUID (`questions.id`). The exact inverse of
 * {@link uuidToRef}: it requires the ref to be a well-formed 32-byte hex word whose high 16 bytes are
 * zero (i.e. a genuinely left-padded UUID). A ref that doesn't conform never maps to a real question —
 * the indexer treats that as an unknown ref and skips it — so this throws rather than guessing.
 * @throws if `ref` is malformed or not a left-padded UUID.
 */
export function refToUuid(ref: string): Uuid {
  const lower = ref.toLowerCase();
  if (!REF_RE.test(lower)) {
    throw new Error(`invalid ref (want 0x + 64 hex): ${ref}`);
  }
  if (lower.slice(2, 34) !== REF_ZERO_HALF) {
    throw new Error(`ref is not a left-padded UUID (high 16 bytes non-zero): ${ref}`);
  }
  const h = lower.slice(34); // low 16 bytes → 32 hex chars
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Like {@link refToUuid} but returns `null` instead of throwing when the ref doesn't conform. Handy in
 * the indexer's per-event loop, where a non-conforming ref must be logged + skipped, never crash the
 * batch.
 */
export function tryRefToUuid(ref: string): Uuid | null {
  try {
    return refToUuid(ref);
  } catch {
    return null;
  }
}

/** Lowercase an EVM address to the casing stored in D1 (all address columns are lowercase). */
export function toLowerAddress(address: string): Address {
  return address.toLowerCase() as Address;
}
