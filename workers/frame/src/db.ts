// SPDX-License-Identifier: MIT
// Drizzle client bound to the D1 binding. The schema is the single source of truth exported by
// @buyananswer/shared (Session 5) — never re-typed here. Same binding the API + indexer use. The
// frame writes ONLY the initial `pending_payment` question row (the same non-money-state insert the
// API's POST /questions does); money-state columns stay the indexer's alone (ADR-0024).

import { creators, questions } from "@buyananswer/shared";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "./env.js";

/** The tables the frame touches: creators (read) + questions (mint the draft row). */
export const schema = { creators, questions } as const;

/** Build a Drizzle client for this invocation's D1 binding. */
export function getDb(env: Env) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;
