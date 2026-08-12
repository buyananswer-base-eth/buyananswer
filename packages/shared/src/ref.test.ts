// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { isUuid, refToUuid, toLowerAddress, tryRefToUuid, uuidToRef } from "./ref.js";

describe("uuid ↔ ref codec", () => {
  it("encodes a UUID as a left-padded bytes32 ref", () => {
    const uuid = "36b8f84d-df4e-4d49-b662-bbfa1046a2b0";
    expect(uuidToRef(uuid)).toBe(
      "0x0000000000000000000000000000000036b8f84ddf4e4d49b662bbfa1046a2b0",
    );
  });

  it("decodes a ref back to its UUID", () => {
    const ref = "0x0000000000000000000000000000000036b8f84ddf4e4d49b662bbfa1046a2b0";
    expect(refToUuid(ref)).toBe("36b8f84d-df4e-4d49-b662-bbfa1046a2b0");
  });

  it("is round-trip for many random UUIDs (crypto.randomUUID shape)", () => {
    for (let i = 0; i < 200; i++) {
      const uuid = crypto.randomUUID();
      expect(refToUuid(uuidToRef(uuid))).toBe(uuid);
    }
  });

  it("uppercases in the ref/uuid are normalized to lowercase", () => {
    const uuid = "36B8F84D-DF4E-4D49-B662-BBFA1046A2B0";
    const ref = uuidToRef(uuid);
    expect(ref).toBe(ref.toLowerCase());
    expect(refToUuid(ref)).toBe(uuid.toLowerCase());
  });

  it("rejects a malformed uuid", () => {
    expect(() => uuidToRef("not-a-uuid")).toThrow();
    expect(isUuid("not-a-uuid")).toBe(false);
  });

  it("rejects a malformed ref", () => {
    expect(() => refToUuid("0xdeadbeef")).toThrow(); // too short
    expect(() =>
      refToUuid("0xzz00000000000000000000000000000000000000000000000000000000000000"),
    ).toThrow();
  });

  it("rejects a ref whose high 16 bytes are non-zero (not a left-padded UUID)", () => {
    // Same low 16 bytes as a valid UUID, but the high half is set — not a conforming ref.
    const bad = "0x0000000000000000000000000000000136b8f84ddf4e4d49b662bbfa1046a2b0";
    expect(() => refToUuid(bad)).toThrow();
    expect(tryRefToUuid(bad)).toBeNull();
  });

  it("tryRefToUuid returns the UUID on success and null on failure", () => {
    const ref = uuidToRef("36b8f84d-df4e-4d49-b662-bbfa1046a2b0");
    expect(tryRefToUuid(ref)).toBe("36b8f84d-df4e-4d49-b662-bbfa1046a2b0");
    expect(tryRefToUuid("0xnothex")).toBeNull();
  });

  it("toLowerAddress lowercases a checksummed address", () => {
    expect(toLowerAddress("0x40A4bfEc9441752BcABBd4b3939503671c8724dB")).toBe(
      "0x40a4bfec9441752bcabbd4b3939503671c8724db",
    );
  });
});
