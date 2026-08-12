// SPDX-License-Identifier: MIT
// The error-reporting SEAM (ADR-0033). Every Worker's `onError` funnels unhandled errors through an
// `ErrorReporter` rather than calling `console.error` directly, so an external sink (Sentry, a Tail
// Worker, Logpush) can be dropped in later as a boundary — not a hard dependency baked into each route.
// The default reporter just writes a structured `evt:"unhandled_error"` line via the shared logger,
// which is exactly what the workers did before, now with request-id correlation.

import type { Logger } from "./logger.js";

/** Context attached to a reported error (the request-scoped correlation fields). */
export interface ErrorContext {
  reqId?: string;
  method?: string;
  path?: string;
  [field: string]: unknown;
}

/** The boundary an external error sink implements. Kept tiny so swapping the sink is a one-file change. */
export interface ErrorReporter {
  report(err: unknown, ctx?: ErrorContext): void;
}

/** Normalise any thrown value to a `{ message, stack? }` pair for logging. */
export function describeError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return err.stack ? { message: err.message, stack: err.stack } : { message: err.message };
  }
  return { message: String(err) };
}

/**
 * The default reporter: emit one `evt:"unhandled_error"` line through `logger`. When the reporter is
 * built per-request from a child logger, the line already carries `reqId`. Swap this for a Sentry/Tail
 * implementation of {@link ErrorReporter} at the app boundary without touching any route.
 */
export function consoleErrorReporter(logger: Logger): ErrorReporter {
  return {
    report(err, ctx = {}) {
      logger.error("unhandled_error", { ...ctx, ...describeError(err) });
    },
  };
}

/** A reporter that drops everything — for tests that assert behaviour without log noise. */
export const noopErrorReporter: ErrorReporter = { report: () => {} };
