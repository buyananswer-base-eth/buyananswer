// SPDX-License-Identifier: MIT
// Per-Farcaster-id rate limiting for the frame POSTs (Session 14, ADR-0032). Frames are limited by the
// VERIFIED `fid`, NOT by client IP: a Farcaster client may relay frame POSTs through shared server
// infrastructure, so an IP window would throttle every user behind that relay at once. Keying on the
// hub-verified fid is both the correct identity and only knowable AFTER verification — so the gate lives
// inside each handler, right after `verify`, never as pre-verify middleware.

import {
  type Logger,
  type RateLimitPolicy,
  describeError,
  kvRateLimiter,
} from "@buyananswer/worker-kit";
import type { Env } from "../env.js";

/** A Farcaster id's budget across all frame action POSTs (≈ 5 complete two-tx asks per minute). */
export const FRAME_LIMIT: RateLimitPolicy = { prefix: "frame_fid", limit: 20, windowSeconds: 60 };

/**
 * Consume one unit of `fid`'s frame-action budget. Returns true when the action may proceed. FAIL-CLOSED:
 * a limiter-store outage denies the action rather than silently disabling the limit on the mint.
 */
export async function allowFrameAction(env: Env, fid: number, log: Logger): Promise<boolean> {
  try {
    const result = await kvRateLimiter(env.RATELIMIT, FRAME_LIMIT).consume(`fid:${fid}`);
    if (!result.allowed)
      log.warn("frame_rate_limited", { fid, count: result.count, limit: result.limit });
    return result.allowed;
  } catch (err) {
    log.error("frame_ratelimit_error", { fid, ...describeError(err) });
    return false;
  }
}
