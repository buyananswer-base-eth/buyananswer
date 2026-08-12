// SPDX-License-Identifier: MIT
// The tail of the approve + askQuestion fallback (ADR-0027), extracted so it is pure and testable:
// wait for the approve receipt, insist it succeeded, then wait until a chain READ actually reflects the
// new allowance before anything simulates `askQuestion`.
//
// Why the second half exists (ADR-0036 F1, reproduced twice on a live Base Sepolia run): a public RPC
// endpoint is a load balancer over many nodes, so it is read-after-write inconsistent. The `eth_call`
// issued immediately after the approve's receipt can be served by a node that has not yet applied the
// approve's block, and the ask then reverts with "ERC20: transfer amount exceeds allowance" against
// state that is already final everywhere else. Nothing moves and the flow's "Try again" recovers, but
// it shows a frightening failure on a perfectly healthy payment.
//
// The wait is BOUNDED and advisory: if the allowance never shows up we return `false` and let the caller
// proceed anyway, so a genuinely wrong allowance still surfaces through the normal simulate → error path
// rather than hanging the flow. Every comparison is `bigint` — allowances are base units, never numbers.

/** How often to re-read the allowance while waiting for the RPC to catch up. */
export const ALLOWANCE_POLL_INTERVAL_MS = 500;
/** The whole wait is capped at this — a stale read must never block the flow indefinitely. */
export const ALLOWANCE_POLL_TIMEOUT_MS = 8_000;

/** Shown when the approve transaction itself reverted (ADR-0036 F2). */
export const APPROVE_REVERTED_MESSAGE =
  "The USDC approval didn't go through on-chain. Please try again.";

/** The only part of a viem `TransactionReceipt` this module cares about. */
export interface ApprovalReceipt {
  readonly status: "success" | "reverted";
}

/** Injectable clock + sleep so the poll is deterministic under test. */
interface Timing {
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface WaitForAllowanceOptions extends Timing {
  /** Re-read `allowance(owner, spender)` from the chain. May reject — that counts as "not yet". */
  readAllowance: () => Promise<bigint>;
  /** The amount the ask is about to spend, in USDC base units. */
  needed: bigint;
}

export interface ConfirmApprovalOptions extends WaitForAllowanceOptions {
  /** Wait for the approve transaction's receipt (viem's `waitForTransactionReceipt`). */
  waitForReceipt: () => Promise<ApprovalReceipt>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Poll `allowance` until a read covers `needed`, or until the timeout.
 *
 * @returns `true` once a read confirmed the allowance; `false` if the bound elapsed first (the caller
 * should carry on regardless — the ask's own simulate is what decides).
 */
export async function waitForAllowance({
  readAllowance,
  needed,
  intervalMs = ALLOWANCE_POLL_INTERVAL_MS,
  timeoutMs = ALLOWANCE_POLL_TIMEOUT_MS,
  sleep = realSleep,
  now = () => Date.now(),
}: WaitForAllowanceOptions): Promise<boolean> {
  const deadline = now() + timeoutMs;
  for (;;) {
    try {
      if ((await readAllowance()) >= needed) return true;
    } catch {
      // A failed read carries the same information as a stale one: nothing. Retry until the deadline.
    }
    const remaining = deadline - now();
    if (remaining <= 0) return false;
    await sleep(Math.min(intervalMs, remaining));
  }
}

/**
 * The approve tail: receipt → status check → allowance wait.
 *
 * Throws {@link APPROVE_REVERTED_MESSAGE} if the approve reverted, so that failure is named instead of
 * re-appearing later as an unexplained "exceeds allowance" on the ask.
 *
 * @returns whether a chain read confirmed the allowance before the bound elapsed.
 */
export async function confirmApproval({
  waitForReceipt,
  ...rest
}: ConfirmApprovalOptions): Promise<boolean> {
  const receipt = await waitForReceipt();
  if (receipt.status !== "success") throw new Error(APPROVE_REVERTED_MESSAGE);
  return waitForAllowance(rest);
}
