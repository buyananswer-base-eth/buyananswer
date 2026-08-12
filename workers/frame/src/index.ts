// SPDX-License-Identifier: MIT
// Worker entrypoint for @buyananswer/frame. Exports the Hono app (the frame HTTP surface) + a
// `scheduled` handler that prunes abandoned `pending_payment` drafts on the cron trigger (ADR-0032).
// `createApp` is exported for tests, which inject a fake FrameVerifier so they never call a live hub.

import { createApp } from "./app.js";
import { getDb } from "./db.js";
import { type Env, resolveConfig } from "./env.js";
import { sweepOrphanedPendingPayments } from "./lib/sweep.js";
import { log } from "./log.js";

export { createApp } from "./app.js";
export type { Env } from "./env.js";

const app = createApp();

/** Prune abandoned drafts. Errors are swallowed to the log (the cron retries on its own schedule). */
async function runSweep(env: Env): Promise<void> {
  try {
    const config = resolveConfig(env);
    const result = await sweepOrphanedPendingPayments(getDb(env), {
      olderThanSeconds: config.orphanTtlSeconds,
    });
    if (result.deleted > 0) log.info("orphan_sweep", { deleted: result.deleted });
  } catch (err) {
    log.error("orphan_sweep_failed", { message: err instanceof Error ? err.message : String(err) });
  }
}

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runSweep(env));
  },
};
