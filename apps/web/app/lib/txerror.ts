// SPDX-License-Identifier: MIT
// Shared helpers for turning a viem/wallet error into user-facing text — used by every money flow (ask,
// answer, decline, cancel, reclaim, withdraw). Pure string formatting; no state, no chain access. This
// distinguishes a genuine user rejection (surface calmly, offer retry) from an on-chain/contract failure
// (show the decoded reason) and maps the escrow's custom errors to plain-language sentences.

/** Flatten a thrown value into a searchable string (viem stacks the useful bits across fields). */
export function errorText(e: unknown): string {
  if (e && typeof e === "object") {
    const anyE = e as {
      name?: string;
      shortMessage?: string;
      details?: string;
      message?: string;
    };
    return [anyE.name, anyE.shortMessage, anyE.details, anyE.message].filter(Boolean).join(" ");
  }
  return String(e);
}

/** True when the wallet reports the user declining a signature or transaction (EIP-1193 4001, etc.). */
export function isUserRejection(e: unknown): boolean {
  return /user rejected|user denied|rejected the request|request rejected|denied (the )?signature|\b4001\b/i.test(
    errorText(e),
  );
}

/** A generic fallback message for a failed transaction, preferring viem's decoded `shortMessage`. */
export function txErrorMessage(e: unknown): string {
  const anyE = e as { shortMessage?: string; message?: string } | undefined;
  return anyE?.shortMessage || anyE?.message || "The transaction failed. Please try again.";
}

/**
 * Map a settle/withdraw failure to plain language, decoding the escrow's custom errors (they surface in
 * viem's message because the ABI carries them). These mostly represent a lost race — the question was
 * settled by someone else, or the deadline moved us into a different action — so the copy explains the
 * new reality rather than implying the user did something wrong.
 */
export function mapSettleError(e: unknown): string {
  const text = errorText(e);
  if (/NotOpen\b/.test(text)) {
    return "This question isn't open anymore — it may have just been settled. Refresh to see its status.";
  }
  if (/NotAnswerer\b/.test(text)) {
    return "Only the creator being asked can answer or decline this question.";
  }
  if (/NotAsker\b/.test(text)) {
    return "Only the person who asked can cancel this question.";
  }
  if (/DeadlinePassed\b/.test(text)) {
    return "The 7-day answer window has closed, so it can no longer be cancelled — it can be reclaimed instead.";
  }
  if (/DeadlineNotPassed\b/.test(text)) {
    return "The answer window hasn't closed yet, so this can't be reclaimed. The asker can cancel it.";
  }
  if (/NothingToWithdraw\b/.test(text)) {
    return "There's nothing to withdraw right now.";
  }
  if (/EnforcedPause\b|is paused/i.test(text)) {
    return "Payments are paused right now. Please try again later.";
  }
  return txErrorMessage(e);
}
