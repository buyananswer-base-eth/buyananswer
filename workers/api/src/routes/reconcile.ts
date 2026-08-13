// SPDX-License-Identifier: MIT
// `POST /reconcile-nudge` — ask the indexer to reconcile NOW instead of waiting for its cron.
//
// WHY THIS EXISTS. A settle is final on Base in ~12s (2s block + 5 confirmations), but the app only
// learned about it on the indexer's cron tick, so users watched a spinner for 74s on average and up
// to 136s. ~85% of that wait was the cron interval — the chain was long done. This collapses it to
// roughly chain speed.
//
// WHAT IT IS NOT. This does not change who writes money-state, or how. The indexer still derives
// every write from confirmed chain events exactly as before (ADR-0024); this only changes WHEN it
// looks. Chain-first is untouched — no client can assert an outcome through this endpoint.
//
// WHY IT IS CALLED REPEATEDLY, not once. The indexer only scans to `head - CONFIRMATIONS`, so a
// nudge fired the instant a receipt lands scans PAST the new event and finds nothing. The client
// therefore nudges on each poll tick until the status flips. Reconcile is idempotent and cheap when
// there is nothing new, so repeats are safe by construction.
//
// SECURITY. The indexer's own `/reconcile` is bearer-gated and fail-closed, and that token must
// never reach a browser. So the browser never talks to the indexer: it calls this authenticated
// endpoint, which forwards over a SERVICE BINDING — Worker-to-Worker, never leaving Cloudflare —
// attaching the token server-side. Requires a session, and is rate-limited in front of that.

import { Hono } from "hono";
import { requireAuth } from "../auth/middleware.js";
import type { AppContext } from "../env.js";
import { LIMITS, ipLimit } from "../lib/limits.js";

export const reconcileRoutes = new Hono<AppContext>();

reconcileRoutes.post("/reconcile-nudge", ipLimit(LIMITS.reconcileNudge), requireAuth, async (c) => {
  const indexer = c.env.INDEXER;
  const token = c.env.RECONCILE_TOKEN?.trim();

  // Unconfigured is not an error the user can act on: the cron still reconciles, so the app just
  // reverts to its old latency. Report it as "not nudged" rather than failing their settle flow.
  if (!indexer || !token) {
    return c.json({ nudged: false, reason: "not_configured" }, 202);
  }

  try {
    // The hostname is ignored by a service binding — only the path matters.
    const res = await indexer.fetch("https://indexer/reconcile", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    return c.json({ nudged: res.ok }, 202);
  } catch {
    // A nudge is an OPTIMISATION. If the indexer is down or slow, the caller must not see an
    // error mid-payment — the cron remains the backstop and the poll keeps running.
    return c.json({ nudged: false, reason: "unavailable" }, 202);
  }
});
