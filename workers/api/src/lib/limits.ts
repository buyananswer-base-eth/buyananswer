// SPDX-License-Identifier: MIT
// Per-endpoint rate-limit policies + the middleware that enforces them (Session 14, ADR-0032). Limits
// key on the client IP (`CF-Connecting-IP`) and sit in FRONT of `requireAuth` — an unauthenticated
// flood is throttled before it ever reaches the session lookup, and the limiter never REPLACES authz.
// Counters live in the `RATELIMIT` KV namespace; a store outage FAILS CLOSED (503, see worker-kit).
//
// Windows are one minute; limits are set comfortably above any single legitimate session's burst so
// normal use never trips them, while a scripted flood does.

import { type RateLimitPolicy, clientIp, rateLimit } from "@buyananswer/worker-kit";
import type { Env } from "../env.js";

/** The named policies. `prefix` namespaces each policy's counters within the shared KV namespace. */
export const LIMITS = {
  /** SIWE nonce issuance (a KV write) — generous, it precedes every login. */
  authNonce: { prefix: "auth_nonce", limit: 30, windowSeconds: 60 },
  /** SIWE verify — the login attempt itself; tighter to blunt signature brute-forcing. */
  authVerify: { prefix: "auth_verify", limit: 10, windowSeconds: 60 },
  /** Handle claim — a one-time action per wallet; a low ceiling is plenty. */
  handleClaim: { prefix: "handle_claim", limit: 8, windowSeconds: 60 },
  /** Profile edits. */
  profileUpdate: { prefix: "profile_update", limit: 20, windowSeconds: 60 },
  /** Question mint — the pre-payment draft insert. */
  questionCreate: { prefix: "question_create", limit: 20, windowSeconds: 60 },
  /** Answer save (upsert). */
  answerSave: { prefix: "answer_save", limit: 30, windowSeconds: 60 },
  /** Publish a Q→A card. */
  questionPublish: { prefix: "question_publish", limit: 30, windowSeconds: 60 },
  /** Avatar upload (an R2 write of up to 5 MB). */
  avatarUpload: { prefix: "avatar_upload", limit: 10, windowSeconds: 60 },
} satisfies Record<string, RateLimitPolicy>;

/** A rate-limit middleware for `policy`, keyed by client IP, reading the `RATELIMIT` KV namespace. */
export function ipLimit(policy: RateLimitPolicy) {
  return rateLimit<Env>({ kv: (env) => env.RATELIMIT, policy, key: clientIp });
}
