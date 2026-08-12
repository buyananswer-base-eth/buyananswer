// SPDX-License-Identifier: MIT
// Drizzle client bound to the D1 binding. The schema is the single source of truth exported by
// @buyananswer/shared (Session 5) — never re-typed here. Same binding the API uses; the indexer is
// the only writer of money-state columns.

import { answers, indexerCursor, questions } from "@buyananswer/shared";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "./env.js";

/** The tables the indexer touches. */
export const schema = { answers, indexerCursor, questions } as const;

/** Build a Drizzle client for this invocation's D1 binding. */
export function getDb(env: Env) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;
