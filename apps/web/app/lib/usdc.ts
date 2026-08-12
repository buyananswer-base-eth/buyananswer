// SPDX-License-Identifier: MIT
// USDC money helpers — the client half of the money path. USDC is 6-decimal base units carried as a
// base-10 integer STRING everywhere on the wire (ADR-0021), because on-chain amounts are uint128 and
// exceed Number.MAX_SAFE_INTEGER. These helpers convert between base units and a human display value
// using BigInt ONLY — never `Number`, never a float. The bounds mirror the API's `minPriceSchema`
// (1–10,000 USDC) so the profile form validates identically to the server.

/** USDC has 6 decimals. */
export const USDC_DECIMALS = 6;
const SCALE = 1_000_000n; // 10 ** 6

/** Min/max creator price, in base units — mirrors the API (`minPriceSchema`): 1–10,000 USDC. */
export const MIN_PRICE_BASE = 1_000_000n; // 1 USDC
export const MAX_PRICE_BASE = 10_000_000_000n; // 10,000 USDC

/** True when `value` is a non-negative base-unit integer string (digits only). */
export function isBaseUnits(value: string): boolean {
  return /^[0-9]+$/.test(value);
}

/**
 * Format base units as a human display string with trailing zeros trimmed:
 * `"5000000" → "5"`, `"5500000" → "5.5"`, `"1230000" → "1.23"`. Returns `"0"` for malformed input
 * (defensive — the API only ever sends valid base units).
 */
export function formatUsdc(base: string): string {
  if (!isBaseUnits(base)) return "0";
  const n = BigInt(base);
  const whole = n / SCALE;
  const frac = n % SCALE;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracStr}`;
}

/** Format base units as an amount with the USDC unit, e.g. `"5000000" → "5 USDC"`. */
export function formatUsdcAmount(base: string): string {
  return `${formatUsdc(base)} USDC`;
}

/**
 * Parse a human display value (e.g. `"5"`, `"5.50"`, `"0.25"`) into base-unit text, or `null` when
 * it isn't a valid USDC decimal (≤ 6 dp). Pure BigInt — no float rounding on the money path.
 */
export function parseUsdc(display: string): string | null {
  const s = display.trim();
  if (!/^[0-9]+(\.[0-9]{1,6})?$/.test(s)) return null;
  const [wholePart, fracPart = ""] = s.split(".");
  const whole = wholePart ?? "0";
  const fracPadded = `${fracPart}000000`.slice(0, USDC_DECIMALS);
  const base = BigInt(whole) * SCALE + BigInt(fracPadded || "0");
  return base.toString();
}

export type PriceValidation = { ok: true; base: string } | { ok: false; reason: string };

/**
 * Validate a price the user typed (in whole/decimal USDC) against the same 1–10,000 bounds the API
 * enforces, returning either base-unit text or a friendly reason.
 */
export function validatePrice(display: string): PriceValidation {
  const base = parseUsdc(display);
  if (base === null) {
    return { ok: false, reason: "Enter a USDC amount (up to 6 decimals)." };
  }
  const n = BigInt(base);
  if (n < MIN_PRICE_BASE) return { ok: false, reason: "Minimum price is 1 USDC." };
  if (n > MAX_PRICE_BASE) return { ok: false, reason: "Maximum price is 10,000 USDC." };
  return { ok: true, base };
}
