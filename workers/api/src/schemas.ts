// SPDX-License-Identifier: MIT
// zod schemas validating every request body at the API boundary (golden rule: validate at the edge).
// These mirror the DB CHECK constraints (FUNCTIONAL_SPEC §3.1) so clients get clean 4xx errors
// instead of raw SQLite failures. Money is base-unit text and never a JS number (ADR-0021).

import { z } from "zod";

/** A normalized, valid handle: lowercased then matched against `^[a-z0-9_]{3,30}$`. */
export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,30}$/, "handle must be 3–30 chars of a–z, 0–9 or _");

/** USDC min price as base-unit text, bounded to 1–10,000 USDC (1e6–1e10 base units). */
export const minPriceSchema = z
  .string()
  .regex(/^[0-9]+$/, "min price must be USDC base units (digits only)")
  .refine((v) => {
    const n = BigInt(v);
    return n >= 1_000_000n && n <= 10_000_000_000n;
  }, "min price must be between 1 and 10,000 USDC");

/** A single off-site profile link. The `url` is scheme-restricted to http/https: a creator's links
 *  render as an `href` on their public board (apps/web BoardView), so a `javascript:`/`data:` URL would
 *  be a click-to-execute stored-XSS vector. The web client already blocks non-http(s) schemes, but the
 *  API is the security boundary — enforce it here too (defense in depth; ADR-0035). */
export const linkSchema = z.object({
  label: z.string().trim().min(1).max(30),
  url: z
    .string()
    .trim()
    .url()
    .max(200)
    .refine((u) => {
      try {
        return ["http:", "https:"].includes(new URL(u).protocol);
      } catch {
        return false;
      }
    }, "link URL must use http or https"),
});

/** Body for `POST /handle/claim` — creates the creator profile keyed by the session wallet. */
export const claimBody = z.object({
  handle: handleSchema,
  displayName: z.string().trim().min(1).max(50).optional(),
  minPriceUsdc: minPriceSchema.optional(),
});

/** Body for `PUT /profile` — every field optional; `null` clears a nullable column. */
export const profileBody = z
  .object({
    displayName: z.string().trim().min(1).max(50).optional(),
    headline: z.string().trim().max(80).nullable().optional(),
    bio: z.string().trim().max(500).nullable().optional(),
    links: z.array(linkSchema).max(10).nullable().optional(),
    minPriceUsdc: minPriceSchema.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "no profile fields to update");

/** Body for `POST /auth/verify`. */
export const verifyBody = z.object({
  message: z.string().min(1),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/, "signature must be 0x-hex"),
});

/**
 * A USDC amount as base-unit text (digits only, > 0, uint128-safe length). This is the amount the
 * asker intends to escrow; the API validates it against the creator's min price but NEVER writes it —
 * `questions.amount_usdc` is indexer-only (ADR-0021). Real bounds are the business rule amount ≥ min.
 */
export const amountUsdcSchema = z
  .string()
  .regex(/^[0-9]+$/, "amount must be USDC base units (digits only)")
  .refine(
    (v) => v.length <= 39 && BigInt(v) > 0n,
    "amount must be a positive USDC base-unit value",
  );

/**
 * Body for `POST /questions` — the asker composes a question for a creator (by handle). The API mints
 * the UUID, inserts a `pending_payment` row, and returns the id. `amountUsdc` is used only to enforce
 * the min-price gate at ask time; it is never persisted (indexer-only).
 */
export const createQuestionBody = z.object({
  handle: handleSchema,
  body: z.string().trim().min(1).max(2000),
  amountUsdc: amountUsdcSchema,
  chainId: z.number().int().positive().optional(),
});

/** Body for `POST /questions/:id/answer` — the hidden answer text (1–5000 chars). */
export const answerBody = z.object({
  body: z.string().trim().min(1).max(5000),
});

/** Query params for the paginated list routes: newest-first, `limit`/`offset` bounded. */
export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ClaimBody = z.infer<typeof claimBody>;
export type ProfileBody = z.infer<typeof profileBody>;
export type ProfileLink = z.infer<typeof linkSchema>;
export type CreateQuestionBody = z.infer<typeof createQuestionBody>;
export type AnswerBody = z.infer<typeof answerBody>;
export type ListQuery = z.infer<typeof listQuery>;
