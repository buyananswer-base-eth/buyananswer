// SPDX-License-Identifier: MIT
// Public surface of @buyananswer/worker-kit — the cross-cutting Worker middleware every service shares:
// a structured logger, a fixed-window KV rate limiter, KV idempotency, an error-reporting seam, and the
// Hono glue that wires them onto a request. See ADR-0032 (rate limiting + idempotency) and ADR-0033
// (observability + error reporting).

export type { Clock, KvLike } from "./kv.js";
export {
  type LogLevel,
  type LogFields,
  type Logger,
  type LogSink,
  consoleSink,
  createLogger,
} from "./logger.js";
export {
  type RateLimitResult,
  type RateLimiter,
  type RateLimitPolicy,
  kvRateLimiter,
} from "./ratelimit.js";
export {
  type IdempotentResult,
  parseIdempotencyKey,
  withIdempotency,
} from "./idempotency.js";
export {
  type ErrorContext,
  type ErrorReporter,
  consoleErrorReporter,
  describeError,
  noopErrorReporter,
} from "./errors.js";
export {
  type ObservabilityVars,
  type RateLimitOptions,
  clientIp,
  getLog,
  getReqId,
  observability,
  rateLimit,
  requestId,
} from "./hono.js";
