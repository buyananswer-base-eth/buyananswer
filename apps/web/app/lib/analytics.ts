// SPDX-License-Identifier: MIT
// Analytics event instrumentation (FUNCTIONAL_SPEC §12). This is a deliberate STUB: it gives us a
// single, typed `track()` seam to call from the flows now, so wiring a real sink later (PostHog,
// Segment, a Worker endpoint) is one implementation change and not a hunt through the UI. In dev it
// logs to the console; in prod it is a no-op until a sink is chosen. Never send PII — pass ids/handles,
// never wallet-linked personal data, and never money as a JS number.

/** The full analytics event vocabulary from FUNCTIONAL_SPEC §12 (only a subset is fired so far). */
export type AnalyticsEvent =
  | "creator_signup"
  | "handle_claimed"
  | "profile_completed"
  | "link_copied"
  | "question_created"
  | "payment_confirmed"
  | "question_answered"
  | "question_declined"
  | "question_cancelled"
  | "question_reclaimed"
  | "card_published"
  | "frame_ask_started"
  | "frame_payment_confirmed";

/** Arbitrary, non-PII properties attached to an event. */
export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

const isDev = typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);

/** Record an analytics event. No-op sink for now; swap the body to wire a real provider. */
export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  if (isDev) {
    // eslint-disable-next-line no-console -- dev-only visibility into instrumentation
    console.debug(`[analytics] ${event}`, props ?? {});
  }
}
