// SPDX-License-Identifier: MIT
// The Hono application: health, SIWE auth, profile/board/avatar, and the question/answer lifecycle.
// A single onError maps ApiError and zod ZodError to clean JSON so every route can just throw. Clients
// never set money-state columns — the API writes only content + the initial `pending_payment` status;
// the indexer owns every money-state transition (ADR-0021).

import { consoleErrorReporter, getLog, observability } from "@buyananswer/worker-kit";
import { Hono } from "hono";
import { ZodError } from "zod";
import type { AppContext } from "./env.js";
import { ApiError } from "./lib/http.js";
import { answerRoutes } from "./routes/answers.js";
import { authRoutes } from "./routes/auth.js";
import { avatarRoutes } from "./routes/avatar.js";
import { boardRoutes } from "./routes/board.js";
import { profileRoutes } from "./routes/profile.js";
import { questionRoutes } from "./routes/questions.js";

/** Service name stamped on every structured log line (FUNCTIONAL_SPEC §11). */
export const SVC = "buyananswer-api";

export function createApp() {
  const app = new Hono<AppContext>();

  // Request-id + a per-request child logger, in front of everything (so onError sees the correlated
  // logger). Errors then flow through the error-reporting SEAM (swap consoleErrorReporter for a
  // Sentry/Tail sink later without touching a route). ADR-0033.
  app.use("*", observability(SVC));

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: err.code, message: err.message }, err.status);
    }
    if (err instanceof ZodError) {
      return c.json({ error: "validation_error", issues: err.issues }, 422);
    }
    const path = new URL(c.req.url).pathname;
    consoleErrorReporter(getLog(c, SVC)).report(err, { method: c.req.method, path });
    return c.json({ error: "internal_error" }, 500);
  });

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  // Liveness + readiness: `ready` surfaces a hard misconfig (a required binding missing).
  app.get("/health", (c) => {
    const ready = Boolean(c.env.DB && c.env.SESSIONS && c.env.AVATARS && c.env.RATELIMIT);
    return c.json({ ok: true, service: SVC, ready });
  });

  app.route("/auth", authRoutes);
  app.route("/", profileRoutes);
  app.route("/", boardRoutes);
  app.route("/", avatarRoutes);
  app.route("/", questionRoutes);
  app.route("/", answerRoutes);

  return app;
}
