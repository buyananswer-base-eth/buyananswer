// SPDX-License-Identifier: MIT
// The indexer nudge. Money-state only moves when the indexer reconciles confirmed chain events into D1
// (ADR-0024, sole writer), and in dev that runs on a `*/2` cron — far too slow to watch in a browser.
// `POST /reconcile` (bearer-gated) runs one pass now, so the UI's own patient polling resolves in
// seconds instead of minutes. This is the same nudge `onchain.spec.ts` uses; it forces no state, it just
// asks the real indexer to do its real job earlier.

import { INDEXER_URL, RECONCILE_TOKEN } from "./env";

/** The indexer rate-limits `/reconcile` at 30/min per IP — 6s (10/min) stays comfortably under it. */
const NUDGE_INTERVAL_MS = 6_000;

export interface ReconcileResult {
  fromBlock: number;
  toBlock: number;
  head: number;
  scanned: number;
  eventsSeen: number;
  transitionsApplied: number;
}

/** Run one reconcile pass. Returns null on any failure (transient RPC/limit errors are not fatal). */
export async function nudgeReconcile(): Promise<ReconcileResult | null> {
  try {
    const res = await fetch(`${INDEXER_URL}/reconcile`, {
      method: "POST",
      headers: { authorization: `Bearer ${RECONCILE_TOKEN}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as ReconcileResult;
  } catch {
    return null;
  }
}

/**
 * Keep nudging in the background for the length of the run, so every UI wait on an indexed status
 * resolves promptly. Returns a stop function.
 */
export function startReconcileNudger(intervalMs = NUDGE_INTERVAL_MS): () => void {
  let stopped = false;
  const timer = setInterval(() => {
    if (!stopped) void nudgeReconcile();
  }, intervalMs);
  // Don't hold the Node process open on teardown.
  timer.unref?.();
  void nudgeReconcile(); // one immediately, so a cold cursor starts catching up right away
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/** True when the indexer is up and its reconcile endpoint accepts our token. */
export async function indexerReady(): Promise<boolean> {
  return (await nudgeReconcile()) !== null;
}
