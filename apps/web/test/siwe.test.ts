// SPDX-License-Identifier: MIT
// The client's SIWE message must round-trip through the SAME library the API validates with
// (viem/siwe on the Worker). These tests parse + validate the built message exactly as the API does,
// so a drift between how we build and how the API binds (domain/nonce/chain) fails here, not in prod.

import { getAddress } from "viem";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { describe, expect, it } from "vitest";
import { SIWE_STATEMENT, buildSiweMessage } from "../app/lib/siwe";

const INPUT = {
  address: "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc", // lowercase — builder must checksum it
  chainId: 84532,
  domain: "localhost:5173",
  uri: "http://localhost:5173",
  nonce: "abcdef1234567890",
  issuedAt: new Date("2026-08-11T00:00:00.000Z"),
};

describe("buildSiweMessage", () => {
  it("produces fields the API's viem/siwe parser reads back", () => {
    const fields = parseSiweMessage(buildSiweMessage(INPUT));
    expect(fields.domain).toBe(INPUT.domain);
    expect(fields.uri).toBe(INPUT.uri);
    expect(fields.nonce).toBe(INPUT.nonce);
    expect(fields.chainId).toBe(INPUT.chainId);
    expect(fields.statement).toBe(SIWE_STATEMENT);
    expect(fields.version).toBe("1");
  });

  it("checksums the address (SIWE requires EIP-55)", () => {
    const fields = parseSiweMessage(buildSiweMessage(INPUT));
    expect(fields.address).toBe(getAddress(INPUT.address));
  });

  it("validates against the exact domain + nonce the API binds", () => {
    const fields = parseSiweMessage(buildSiweMessage(INPUT));
    const ok = validateSiweMessage({
      message: fields,
      domain: INPUT.domain,
      nonce: INPUT.nonce,
      time: new Date("2026-08-11T00:01:00.000Z"),
    });
    expect(ok).toBe(true);
  });

  it("fails validation on a domain mismatch (the binding)", () => {
    const fields = parseSiweMessage(buildSiweMessage(INPUT));
    const ok = validateSiweMessage({ message: fields, domain: "evil.example", nonce: INPUT.nonce });
    expect(ok).toBe(false);
  });
});
