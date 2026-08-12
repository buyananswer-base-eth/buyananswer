// SPDX-License-Identifier: MIT
// Small formatting helpers shared across the UI.

/** Shorten a hex address for display, e.g. `0x1234…cDeF`. */
export function truncateAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

/** A value that can stand in for an instant on the wire. */
export type EpochInput = number | string | null | undefined;

/**
 * Normalize a timestamp/deadline to epoch **milliseconds**, or `null` if absent/unparseable. Accepts
 * either unix *seconds* (a number — how on-chain deadlines are expressed) or an ISO-8601 string (the API
 * serializes Drizzle `Date` columns to ISO via `JSON.stringify`), so callers don't have to care which the
 * server sent. Sub-`1e12` numbers are read as seconds (any ms instant past ~2001 exceeds 1e12).
 */
export function toEpochMs(value: EpochInput): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value < 1e12 ? value * 1000 : value;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Format an instant as a compact local date, e.g. `"Aug 18, 2026"`; `"—"` when absent/unparseable. */
export function formatDate(value: EpochInput): string {
  const ms = toEpochMs(value);
  if (ms == null) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
