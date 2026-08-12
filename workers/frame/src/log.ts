// SPDX-License-Identifier: MIT
// Structured logging for the frame Worker, on the shared logger (@buyananswer/worker-kit, ADR-0033):
// every line is a single `{svc, level, evt, ...}` JSON object queryable in Workers logs / Logpush. This
// also carries the frame analytics events (FUNCTIONAL_SPEC §12): `frame_ask_started` when a question
// row is minted, `frame_payment_confirmed` when the ask tx has been sent from the feed.

import { type LogFields, createLogger } from "@buyananswer/worker-kit";

/** Service name stamped on every frame log line. */
export const SVC = "buyananswer-frame";

/** The module logger (the HTTP layer uses a request-scoped child via `observability`). */
export const log = createLogger(SVC);

/** Frame analytics event names (the subset of FUNCTIONAL_SPEC §12 the frame fires). */
export type FrameEvent = "frame_ask_started" | "frame_payment_confirmed";

/** Emit a frame analytics event (no PII — fid + handle + question id only, never a raw body). */
export function track(event: FrameEvent, fields: LogFields = {}): void {
  log.info("analytics", { event, ...fields });
}
