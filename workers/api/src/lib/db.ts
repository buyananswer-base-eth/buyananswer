// SPDX-License-Identifier: MIT
// Drizzle client bound to the D1 binding. The schema is the single source of truth exported by
// @buyananswer/shared (Session 5) — never re-typed here.

import { answers, creators, indexerCursor, questions } from "@buyananswer/shared";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "../env.js";

/** The tables Drizzle needs for relational queries. */
export const schema = { answers, creators, indexerCursor, questions } as const;

/** Build a Drizzle client for this request's D1 binding. */
export function getDb(env: Env) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;

/**
 * True when a D1/SQLite error is a UNIQUE-constraint violation (e.g. a duplicate handle). Drizzle /
 * D1 may nest the SQLite message in the error's `cause`, so we walk the cause chain.
 */
export function isUniqueViolation(err: unknown): boolean {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current != null; depth++) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return /UNIQUE constraint failed/i.test(parts.join(" "));
}
