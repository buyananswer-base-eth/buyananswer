// SPDX-License-Identifier: MIT
// USDC money helpers: base-unit ⇄ display conversion is BigInt-only and the bounds mirror the API.

import { describe, expect, it } from "vitest";
import { formatUsdc, formatUsdcAmount, parseUsdc, validatePrice } from "../app/lib/usdc";

describe("formatUsdc", () => {
  it("trims trailing zeros", () => {
    expect(formatUsdc("1000000")).toBe("1");
    expect(formatUsdc("5500000")).toBe("5.5");
    expect(formatUsdc("1230000")).toBe("1.23");
    expect(formatUsdc("1")).toBe("0.000001");
    expect(formatUsdc("0")).toBe("0");
    expect(formatUsdc("10000000000")).toBe("10000");
  });

  it("handles large uint128-scale values without precision loss", () => {
    // Beyond Number.MAX_SAFE_INTEGER — must stay exact via BigInt.
    expect(formatUsdc("123456789012345678")).toBe("123456789012.345678");
  });

  it("is defensive against malformed input", () => {
    expect(formatUsdc("abc")).toBe("0");
    expect(formatUsdc("")).toBe("0");
    expect(formatUsdc("-5")).toBe("0");
  });

  it("formats with unit", () => {
    expect(formatUsdcAmount("5000000")).toBe("5 USDC");
  });
});

describe("parseUsdc", () => {
  it("parses whole and decimal amounts to base units", () => {
    expect(parseUsdc("1")).toBe("1000000");
    expect(parseUsdc("5.5")).toBe("5500000");
    expect(parseUsdc("0.000001")).toBe("1");
    expect(parseUsdc("10000")).toBe("10000000000");
  });

  it("rejects invalid input", () => {
    expect(parseUsdc("5.1234567")).toBeNull(); // > 6 dp
    expect(parseUsdc("abc")).toBeNull();
    expect(parseUsdc("")).toBeNull();
    expect(parseUsdc("1.")).toBeNull();
    expect(parseUsdc("-1")).toBeNull();
    expect(parseUsdc("1,000")).toBeNull();
  });

  it("round-trips with formatUsdc", () => {
    for (const base of ["1000000", "5500000", "1230000", "10000000000", "250000"]) {
      expect(parseUsdc(formatUsdc(base))).toBe(base);
    }
  });
});

describe("validatePrice", () => {
  it("accepts values within 1–10,000 USDC", () => {
    expect(validatePrice("1")).toEqual({ ok: true, base: "1000000" });
    expect(validatePrice("5.25")).toEqual({ ok: true, base: "5250000" });
    expect(validatePrice("10000")).toEqual({ ok: true, base: "10000000000" });
  });

  it("rejects below the minimum", () => {
    const r = validatePrice("0.5");
    expect(r.ok).toBe(false);
  });

  it("rejects above the maximum", () => {
    const r = validatePrice("10000.01");
    expect(r.ok).toBe(false);
  });

  it("rejects non-numeric input", () => {
    expect(validatePrice("free").ok).toBe(false);
  });
});
