// SPDX-License-Identifier: MIT
// The structured logger: line shape, child field-pinning, level routing, and the audit helper. Uses a
// capturing sink so nothing hits the console.

import { describe, expect, it } from "vitest";
import { type LogLevel, createLogger } from "./logger.js";

function capturing() {
  const lines: Array<{ level: LogLevel; line: Record<string, unknown> }> = [];
  return {
    lines,
    sink: (level: LogLevel, line: Record<string, unknown>) => lines.push({ level, line }),
  };
}

describe("createLogger", () => {
  it("emits a single {svc, level, evt, ...fields} object per line", () => {
    const { lines, sink } = capturing();
    const log = createLogger("buyananswer-test", {}, sink);
    log.info("started", { port: 8787 });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe("info");
    expect(lines[0]?.line).toEqual({
      svc: "buyananswer-test",
      level: "info",
      evt: "started",
      port: 8787,
    });
  });

  it("routes levels and stamps the level field", () => {
    const { lines, sink } = capturing();
    const log = createLogger("svc", {}, sink);
    log.warn("w");
    log.error("e");
    expect(lines.map((l) => l.level)).toEqual(["warn", "error"]);
    expect(lines.map((l) => l.line.level)).toEqual(["warn", "error"]);
  });

  it("child() pins base fields onto every line; per-call fields win on conflict", () => {
    const { lines, sink } = capturing();
    const log = createLogger("svc", {}, sink).child({ reqId: "r-1", scope: "base" });
    log.info("evt", { scope: "override", extra: 1 });
    expect(lines[0]?.line).toMatchObject({ reqId: "r-1", scope: "override", extra: 1 });
  });

  it("audit() emits an evt:'audit' line carrying the action", () => {
    const { lines, sink } = capturing();
    const log = createLogger("svc", { reqId: "r-1" }, sink);
    log.audit("handle_claim", { wallet: "0xabc", handle: "satoshi" });
    expect(lines[0]?.line).toEqual({
      svc: "svc",
      level: "info",
      evt: "audit",
      reqId: "r-1",
      action: "handle_claim",
      wallet: "0xabc",
      handle: "satoshi",
    });
  });
});
