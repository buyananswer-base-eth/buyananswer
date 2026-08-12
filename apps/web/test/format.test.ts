// SPDX-License-Identifier: MIT
// Timestamp normalization: the API serializes Drizzle `Date` columns to ISO strings, while on-chain
// deadlines are unix seconds — `toEpochMs` accepts either and yields epoch ms (or null).

import { describe, expect, it } from "vitest";
import { formatDate, toEpochMs, truncateAddress } from "../app/lib/format";

describe("toEpochMs", () => {
  it("reads sub-1e12 numbers as unix seconds", () => {
    expect(toEpochMs(1_700_000_000)).toBe(1_700_000_000_000);
  });

  it("passes through ms-scale numbers unchanged", () => {
    expect(toEpochMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it("parses ISO-8601 strings", () => {
    expect(toEpochMs("2023-11-14T22:13:20.000Z")).toBe(Date.parse("2023-11-14T22:13:20.000Z"));
  });

  it("returns null for absent or unparseable values", () => {
    expect(toEpochMs(null)).toBeNull();
    expect(toEpochMs(undefined)).toBeNull();
    expect(toEpochMs("not a date")).toBeNull();
    expect(toEpochMs(Number.NaN)).toBeNull();
  });
});

describe("formatDate", () => {
  it("renders a date for both wire forms and — for absent values", () => {
    const iso = "2026-08-18T00:00:00.000Z";
    expect(formatDate(iso)).toBe(formatDate(Math.floor(Date.parse(iso) / 1000)));
    expect(formatDate(null)).toBe("—");
  });
});

describe("truncateAddress", () => {
  it("keeps the ends and elides the middle", () => {
    expect(truncateAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });
});
