// SPDX-License-Identifier: MIT
// Presentation helpers for the question lifecycle (FUNCTIONAL_SPEC §5). Pure + framework-agnostic so the
// inbox, the detail view, and history all label a status identically — and so the branching logic (which
// action is available, is the deadline past) is unit-testable without rendering. None of this decides
// money-state: the API/indexer own `status`; these functions only *describe* it and gate which affordance
// the UI offers. The contract remains authoritative on the actual fees/deadline.

import type { Address, QuestionStatus } from "@buyananswer/shared";
import { type EpochInput, toEpochMs } from "./format";

/** Badge tones (mirrors the Badge component's tone union). */
export type StatusTone = "neutral" | "accent" | "success" | "danger" | "warning";

interface StatusMeta {
  label: string;
  tone: StatusTone;
}

// The default on-chain fees (bps) — capped + set at deploy (answer 4.2%, cancel 1%; PROGRESS/ADR-0018).
// Used only for human copy; the contract is the source of truth for the amounts actually moved.
export const ANSWER_FEE_PERCENT = "4.2%";
export const CANCEL_FEE_PERCENT = "1%";

const STATUS_META: Record<QuestionStatus, StatusMeta> = {
  pending_payment: { label: "Awaiting payment", tone: "neutral" },
  open: { label: "Open", tone: "accent" },
  answered: { label: "Answered", tone: "success" },
  declined: { label: "Declined", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  reclaimed: { label: "Refunded", tone: "neutral" },
};

/** Short human label for a status (e.g. `open → "Open"`). */
export function statusLabel(status: QuestionStatus): string {
  return STATUS_META[status].label;
}

/** Badge tone for a status. */
export function statusTone(status: QuestionStatus): StatusTone {
  return STATUS_META[status].tone;
}

/** Terminal statuses are settled on-chain and admit no further action. */
export function isTerminalStatus(status: QuestionStatus): boolean {
  return (
    status === "answered" ||
    status === "declined" ||
    status === "cancelled" ||
    status === "reclaimed"
  );
}

/** A question can be answered/declined/cancelled/reclaimed only while it is `open` (escrow funded). */
export function isSettleable(status: QuestionStatus): boolean {
  return status === "open";
}

/** The viewer's role on a question, or `null` if they are neither party (shouldn't happen post-authz). */
export function roleFor(
  wallet: Address | string | undefined,
  q: { askerWallet: Address; answererWallet: Address },
): "asker" | "answerer" | null {
  if (!wallet) return null;
  const w = wallet.toLowerCase();
  if (w === q.answererWallet.toLowerCase()) return "answerer";
  if (w === q.askerWallet.toLowerCase()) return "asker";
  return null;
}

/**
 * True once the on-chain answer window has elapsed. Before the deadline only the asker may cancel (−fee);
 * on/after it, anyone may reclaim for the asker (free). `answerDeadline` may be unix seconds (a number) or
 * an ISO string (how the API serializes it); `null`/absent means not yet indexed → treat as not passed.
 */
export function isPastDeadline(answerDeadline: EpochInput, nowMs: number = Date.now()): boolean {
  const ms = toEpochMs(answerDeadline);
  if (ms == null) return false;
  return nowMs >= ms;
}

/**
 * Which settle action the *asker* can take on an open question: `cancel` before the deadline, `reclaim`
 * after it, `null` when the question isn't open. (The answerer's actions — answer/decline — don't depend
 * on the deadline.)
 */
export function askerActionFor(
  status: QuestionStatus,
  answerDeadline: EpochInput,
  nowMs: number = Date.now(),
): "cancel" | "reclaim" | null {
  if (status !== "open") return null;
  return isPastDeadline(answerDeadline, nowMs) ? "reclaim" : "cancel";
}

/**
 * A short countdown relative to the deadline: `"5 days left"`, `"Last day"`, or `"Expired 2 days ago"`.
 * Whole days, floored; the exact-day boundary reads as "Last day". Returns `""` when the deadline is
 * unknown (not yet indexed).
 */
export function deadlineCountdown(answerDeadline: EpochInput, nowMs: number = Date.now()): string {
  const deadlineMs = toEpochMs(answerDeadline);
  if (deadlineMs == null) return "";
  const dayMs = 86_400_000;
  if (nowMs >= deadlineMs) {
    const daysAgo = Math.floor((nowMs - deadlineMs) / dayMs);
    if (daysAgo <= 0) return "Expired today";
    return `Expired ${daysAgo} day${daysAgo === 1 ? "" : "s"} ago`;
  }
  const daysLeft = Math.floor((deadlineMs - nowMs) / dayMs);
  if (daysLeft <= 0) return "Last day";
  return `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
}
