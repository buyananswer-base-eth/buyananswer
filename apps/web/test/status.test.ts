// SPDX-License-Identifier: MIT
// Lifecycle presentation logic: labels/tones, terminal/settleable predicates, role resolution, and the
// deadline-driven cancel-vs-reclaim branch. Pure functions, so a fixed `now` keeps the tests deterministic.

import { describe, expect, it } from "vitest";
import {
  askerActionFor,
  deadlineCountdown,
  isPastDeadline,
  isSettleable,
  isTerminalStatus,
  roleFor,
  statusLabel,
  statusTone,
} from "../app/lib/status";

const NOW = 1_700_000_000_000; // fixed "now" in ms
const secs = (ms: number) => Math.floor(ms / 1000);

describe("statusLabel / statusTone", () => {
  it("labels every status", () => {
    expect(statusLabel("pending_payment")).toBe("Awaiting payment");
    expect(statusLabel("open")).toBe("Open");
    expect(statusLabel("answered")).toBe("Answered");
    expect(statusLabel("declined")).toBe("Declined");
    expect(statusLabel("cancelled")).toBe("Cancelled");
    expect(statusLabel("reclaimed")).toBe("Refunded");
  });

  it("uses success for answered and accent for open", () => {
    expect(statusTone("answered")).toBe("success");
    expect(statusTone("open")).toBe("accent");
    expect(statusTone("declined")).toBe("warning");
  });
});

describe("isTerminalStatus / isSettleable", () => {
  it("treats the four settled states as terminal", () => {
    for (const s of ["answered", "declined", "cancelled", "reclaimed"] as const) {
      expect(isTerminalStatus(s)).toBe(true);
    }
    expect(isTerminalStatus("open")).toBe(false);
    expect(isTerminalStatus("pending_payment")).toBe(false);
  });

  it("only an open question is settleable", () => {
    expect(isSettleable("open")).toBe(true);
    expect(isSettleable("answered")).toBe(false);
    expect(isSettleable("pending_payment")).toBe(false);
  });
});

describe("roleFor", () => {
  const q = {
    askerWallet: "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa" as const,
    answererWallet: "0xBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbb" as const,
  };

  it("matches case-insensitively", () => {
    expect(roleFor("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", q)).toBe("asker");
    expect(roleFor("0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", q)).toBe("answerer");
  });

  it("returns null for a non-participant or missing wallet", () => {
    expect(roleFor("0xcccccccccccccccccccccccccccccccccccccccc", q)).toBeNull();
    expect(roleFor(undefined, q)).toBeNull();
  });
});

describe("isPastDeadline", () => {
  it("is false when the deadline is unknown", () => {
    expect(isPastDeadline(null, NOW)).toBe(false);
  });

  it("compares seconds against ms-now", () => {
    expect(isPastDeadline(secs(NOW) - 10, NOW)).toBe(true);
    expect(isPastDeadline(secs(NOW) + 10, NOW)).toBe(false);
  });

  it("treats the exact boundary as passed", () => {
    expect(isPastDeadline(secs(NOW), NOW)).toBe(true);
  });

  it("also accepts an ISO string (how the API serializes the Date column)", () => {
    expect(isPastDeadline(new Date(NOW - 10_000).toISOString(), NOW)).toBe(true);
    expect(isPastDeadline(new Date(NOW + 10_000).toISOString(), NOW)).toBe(false);
  });
});

describe("askerActionFor", () => {
  it("offers cancel before the deadline, reclaim after", () => {
    expect(askerActionFor("open", secs(NOW) + 86_400, NOW)).toBe("cancel");
    expect(askerActionFor("open", secs(NOW) - 86_400, NOW)).toBe("reclaim");
    // ISO-string deadline (the wire form) branches identically.
    expect(askerActionFor("open", new Date(NOW + 86_400_000).toISOString(), NOW)).toBe("cancel");
    expect(askerActionFor("open", new Date(NOW - 86_400_000).toISOString(), NOW)).toBe("reclaim");
  });

  it("offers nothing on a non-open question", () => {
    expect(askerActionFor("answered", secs(NOW) - 86_400, NOW)).toBeNull();
    expect(askerActionFor("pending_payment", null, NOW)).toBeNull();
  });
});

describe("deadlineCountdown", () => {
  it("counts days left and days past", () => {
    expect(deadlineCountdown(secs(NOW + 5 * 86_400_000), NOW)).toBe("5 days left");
    expect(deadlineCountdown(secs(NOW + 86_400_000), NOW)).toBe("1 day left");
    expect(deadlineCountdown(secs(NOW - 2 * 86_400_000), NOW)).toBe("Expired 2 days ago");
  });

  it("reads the sub-day edges as last day / expired today", () => {
    expect(deadlineCountdown(secs(NOW + 3600_000), NOW)).toBe("Last day");
    expect(deadlineCountdown(secs(NOW - 3600_000), NOW)).toBe("Expired today");
  });

  it("is empty when the deadline is unknown", () => {
    expect(deadlineCountdown(null, NOW)).toBe("");
  });
});
