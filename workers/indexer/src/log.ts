// SPDX-License-Identifier: MIT
// The money-state audit trail (FUNCTIONAL_SPEC §11), on top of the shared structured logger
// (@buyananswer/worker-kit, ADR-0033). Every log line is a single JSON object with a stable
// `{svc, level, evt, ...}` shape so it queries cleanly in Workers logs / Logpush. The audit events
// (evt: "money_state") are the durable record of every attempted money-state transition — applied or
// skipped — so a human can reconstruct why a question is in its current state.

import { createLogger } from "@buyananswer/worker-kit";

/** Service name stamped on every indexer log line. */
export const SVC = "buyananswer-indexer";

/** The module logger for the reconcile/scheduled core (the HTTP layer uses a request-scoped child). */
export const log = createLogger(SVC);

/** The outcome of a single event application, recorded in the audit trail. */
export type AuditOutcome =
  | "applied" // the money-state transition fired (from → to)
  | "noop_already" // the row was already at/past the target state — idempotent replay
  | "noop_precondition" // the row wasn't in the required prior state (e.g. settle before ask)
  | "unknown_ref"; // no question row for this ref — ask never seen / non-conforming ref

/** The on-chain identity of the event being audited — the same for every outcome. */
export interface AuditBase {
  eventName: string;
  ref: string;
  onchainId: string;
  txHash: string;
  logIndex: number;
  blockNumber: string;
}

/** A full money-state audit line: the event identity plus the outcome + transition. */
export interface AuditFields extends AuditBase {
  outcome: AuditOutcome;
  from?: string;
  to?: string;
  questionId?: string;
}

/** Emit one money-state audit line (the durable record of every attempted transition). */
export function auditMoneyState(fields: AuditFields): void {
  if (fields.outcome === "unknown_ref") log.warn("money_state", { ...fields });
  else log.info("money_state", { ...fields });
}
