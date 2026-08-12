// SPDX-License-Identifier: MIT
// The one structured logger every Worker shares. Each line is a single JSON object with a stable
// `{svc, level, evt, ...}` shape so it queries cleanly in Workers logs / Logpush. This lifts the
// identical `log.ts` the indexer + frame each carried into one place and adds `child(base)` so a
// per-request logger can pin correlation fields (`reqId`, `svc`) onto every line it emits.
//
// No timestamp is emitted — the Workers platform stamps each log line itself, and leaving it out keeps
// test output deterministic (the pre-existing indexer/frame behaviour).

export type LogLevel = "info" | "warn" | "error";

/** Arbitrary structured fields merged into a log line (must be JSON-serialisable). */
export type LogFields = Record<string, unknown>;

/** A structured logger. `child` returns a logger that pins `base` fields onto every line. */
export interface Logger {
  info(evt: string, fields?: LogFields): void;
  warn(evt: string, fields?: LogFields): void;
  error(evt: string, fields?: LogFields): void;
  /** Emit an `evt:"audit"` line for a sensitive action (auth/profile/question mutations). */
  audit(action: string, fields?: LogFields): void;
  /** A logger that merges `base` into every line (e.g. `{ reqId }` for request correlation). */
  child(base: LogFields): Logger;
}

/** The sink a logger writes to. Real loggers use {@link consoleSink}; tests capture lines. */
export type LogSink = (level: LogLevel, line: Record<string, unknown>) => void;

/** Route a structured line to the matching console method (so log levels survive to Logpush). */
export const consoleSink: LogSink = (level, line) => {
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
};

/**
 * Build a logger for service `svc`. `base` fields are merged into every line; `sink` is injectable so
 * tests capture output without touching the console.
 */
export function createLogger(
  svc: string,
  base: LogFields = {},
  sink: LogSink = consoleSink,
): Logger {
  const emit = (level: LogLevel, evt: string, fields: LogFields = {}): void => {
    sink(level, { svc, level, evt, ...base, ...fields });
  };
  return {
    info: (evt, fields) => emit("info", evt, fields),
    warn: (evt, fields) => emit("warn", evt, fields),
    error: (evt, fields) => emit("error", evt, fields),
    audit: (action, fields) => emit("info", "audit", { action, ...fields }),
    child: (childBase) => createLogger(svc, { ...base, ...childBase }, sink),
  };
}
