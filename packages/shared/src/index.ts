// SPDX-License-Identifier: MIT
// Public surface of @buyananswer/shared.

/** Trivial hello-world sentinel so the package builds, typechecks, and tests green. */
export function sharedHello(): string {
  return "buyananswer:shared ready";
}

// Escrow contract bindings — ABI (generated from contracts/out) + per-chain address/startBlock.
export * from "./contracts/index.js";

// Data layer — Drizzle schema (D1/SQLite), inferred row types, and shared value enums.
export * from "./db/index.js";

// On-chain ↔ off-chain linking codec: UUID (`questions.id`) ⇄ `bytes32 ref` (FUNCTIONAL_SPEC §6).
export * from "./ref.js";
