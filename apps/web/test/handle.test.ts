// SPDX-License-Identifier: MIT
// Handle validation mirrors the server rule (instant client feedback; server stays authoritative).
// The parity test reads the API's reserved list from source and asserts the client mirror matches it,
// so the two can't silently drift.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HANDLE_REGEX, RESERVED_HANDLES, validateHandle } from "../app/lib/handle";

describe("validateHandle", () => {
  it("accepts a valid handle and normalizes case/whitespace", () => {
    expect(validateHandle("alice_99")).toEqual({ ok: true, handle: "alice_99" });
    expect(validateHandle("  Alice  ")).toEqual({ ok: true, handle: "alice" });
  });

  it("rejects too short / too long", () => {
    expect(validateHandle("ab").ok).toBe(false);
    expect(validateHandle("a".repeat(31)).ok).toBe(false);
  });

  it("rejects invalid characters", () => {
    expect(validateHandle("bad-handle").ok).toBe(false);
    expect(validateHandle("space bar").ok).toBe(false);
    expect(validateHandle("emoji😀").ok).toBe(false);
  });

  it("rejects reserved handles", () => {
    for (const reserved of ["admin", "api", "dashboard", "settings", "p"]) {
      expect(validateHandle(reserved).ok).toBe(false);
    }
  });

  it("uses the canonical regex", () => {
    expect(HANDLE_REGEX.test("good_handle_1")).toBe(true);
    expect(HANDLE_REGEX.test("Bad")).toBe(false);
  });
});

describe("reserved-handle parity with the API", () => {
  it("matches workers/api/src/lib/handles.ts RESERVED_HANDLES exactly", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../../../workers/api/src/lib/handles.ts", import.meta.url)),
      "utf8",
    );
    const block = src.slice(
      src.indexOf("RESERVED_HANDLES"),
      src.indexOf("]);", src.indexOf("RESERVED_HANDLES")),
    );
    const serverList = [...block.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1] as string).sort();
    const clientList = [...RESERVED_HANDLES].sort();
    expect(clientList).toEqual(serverList);
  });
});
