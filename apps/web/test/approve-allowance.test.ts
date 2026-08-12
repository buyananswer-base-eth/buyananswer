// SPDX-License-Identifier: MIT
// Session 18 — the named APPROVE→ASK regression (ADR-0036 F1 + F2).
//
// The live Base Sepolia dry run hit this twice: the approve landed, and the `askQuestion` simulate fired
// on the very next tick still reverted with "ERC20: transfer amount exceeds allowance", because the
// load-balanced RPC served that `eth_call` from a node one block behind. Nothing moved — but a healthy
// payment showed the user a failure and needed "Try again".
//
// `lib/allowance.ts` is the fix, and this pins its contract:
//   F1 — a stale read is retried until the allowance shows up, and the retry loop is strictly bounded;
//   F2 — a reverted approve fails with its OWN message instead of surfacing later as F1 with no cause.
// The React wiring that calls it is exercised by a multi-actor harness on the live chain, which is
// maintained out of tree.

import { describe, expect, it } from "vitest";
import {
  ALLOWANCE_POLL_INTERVAL_MS,
  ALLOWANCE_POLL_TIMEOUT_MS,
  APPROVE_REVERTED_MESSAGE,
  confirmApproval,
  waitForAllowance,
} from "../app/lib/allowance";

/** 1 USDC in base units — what the harness's askers actually pay. */
const ONE_USDC = 1_000_000n;

/**
 * A fake clock: `sleep` advances it instead of waiting, so a poll bounded at 8 real seconds runs
 * instantly and the elapsed time is exactly assertable.
 */
function fakeClock() {
  let t = 1_000;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    elapsed: () => t - 1_000,
  };
}

/** An RPC that answers `answers` in order, then repeats the last one forever. */
function rpc(answers: Array<bigint | Error>) {
  const calls: number[] = [];
  return {
    reads: () => calls.length,
    readAllowance: async () => {
      const a = answers[Math.min(calls.length, answers.length - 1)] as bigint | Error;
      calls.push(1);
      if (a instanceof Error) throw a;
      return a;
    },
  };
}

describe("regression: approve→ask survives a read-after-write-inconsistent RPC (F1)", () => {
  it("retries a stale allowance read until the approve is visible, instead of failing on the first", async () => {
    const clock = fakeClock();
    // Two stale reads (the pre-approve allowance), then the node catches up.
    const chain = rpc([0n, 0n, ONE_USDC]);
    const covered = await waitForAllowance({
      readAllowance: chain.readAllowance,
      needed: ONE_USDC,
      ...clock,
    });
    expect(covered).toBe(true);
    expect(chain.reads()).toBe(3);
    expect(clock.elapsed()).toBe(2 * ALLOWANCE_POLL_INTERVAL_MS);
  });

  it("costs nothing when the RPC is already consistent — one read, no sleep", async () => {
    const clock = fakeClock();
    const chain = rpc([ONE_USDC]);
    expect(
      await waitForAllowance({ readAllowance: chain.readAllowance, needed: ONE_USDC, ...clock }),
    ).toBe(true);
    expect(chain.reads()).toBe(1);
    expect(clock.elapsed()).toBe(0);
  });

  it("treats a failed read as 'not yet', not as a fatal error", async () => {
    const clock = fakeClock();
    const chain = rpc([new Error("HTTP request failed"), ONE_USDC]);
    expect(
      await waitForAllowance({ readAllowance: chain.readAllowance, needed: ONE_USDC, ...clock }),
    ).toBe(true);
    expect(chain.reads()).toBe(2);
  });

  it("is BOUNDED: an RPC that never catches up gives up at the cap and hands back to the caller", async () => {
    const clock = fakeClock();
    const chain = rpc([0n]);
    expect(
      await waitForAllowance({ readAllowance: chain.readAllowance, needed: ONE_USDC, ...clock }),
    ).toBe(false);
    // Never waits past the cap, and never spins hot inside it.
    expect(clock.elapsed()).toBe(ALLOWANCE_POLL_TIMEOUT_MS);
    expect(chain.reads()).toBe(ALLOWANCE_POLL_TIMEOUT_MS / ALLOWANCE_POLL_INTERVAL_MS + 1);
  });

  it("keeps the comparison in bigint — no float rounding at USDC scale", async () => {
    const clock = fakeClock();
    // Both sides exceed Number.MAX_SAFE_INTEGER and differ by ONE base unit: as numbers they compare
    // equal, so a `Number()` anywhere in this path would wrongly declare the allowance sufficient.
    const needed = 9_007_199_254_740_993n; // 2^53 + 1
    const short = needed - 1n;
    expect(Number(short) === Number(needed)).toBe(true);
    const chain = rpc([short]);
    expect(await waitForAllowance({ readAllowance: chain.readAllowance, needed, ...clock })).toBe(
      false,
    );
  });

  it("accepts an allowance that lands exactly on the amount, and any excess above it", async () => {
    const clock = fakeClock();
    for (const allowance of [ONE_USDC, ONE_USDC + 1n, 2n ** 256n - 1n]) {
      expect(
        await waitForAllowance({
          readAllowance: rpc([allowance]).readAllowance,
          needed: ONE_USDC,
          ...clock,
        }),
      ).toBe(true);
    }
  });
});

describe("regression: a reverted approve is named, not left to look like F1 (F2)", () => {
  const receipt = (status: "success" | "reverted") => async () => ({ status });

  it("throws its own message and never reaches the allowance wait", async () => {
    const chain = rpc([ONE_USDC]);
    await expect(
      confirmApproval({
        waitForReceipt: receipt("reverted"),
        readAllowance: chain.readAllowance,
        needed: ONE_USDC,
        ...fakeClock(),
      }),
    ).rejects.toThrow(APPROVE_REVERTED_MESSAGE);
    expect(chain.reads()).toBe(0);
  });

  it("on a successful approve, waits out the stale window before reporting the allowance is there", async () => {
    const clock = fakeClock();
    const chain = rpc([0n, ONE_USDC]);
    expect(
      await confirmApproval({
        waitForReceipt: receipt("success"),
        readAllowance: chain.readAllowance,
        needed: ONE_USDC,
        ...clock,
      }),
    ).toBe(true);
    expect(chain.reads()).toBe(2);
  });

  it("still returns (falsy) rather than throwing when the allowance never appears — the ask's own simulate decides", async () => {
    expect(
      await confirmApproval({
        waitForReceipt: receipt("success"),
        readAllowance: rpc([0n]).readAllowance,
        needed: ONE_USDC,
        ...fakeClock(),
      }),
    ).toBe(false);
  });
});
