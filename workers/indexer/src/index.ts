// SPDX-License-Identifier: MIT
// Worker entrypoint for @buyananswer/indexer. Exports a module with both a `fetch` handler (the Hono
// app: /health + POST /reconcile) and a `scheduled` handler (the Cron Trigger that reconciles on an
// interval). The reconcile core is exported for tests, which drive it with a mocked ChainReader.

import { createApp } from "./app.js";
import { ViemChainReader } from "./chain.js";
import { getDb } from "./db.js";
import { type Env, orphanTtlSeconds, resolveConfig } from "./env.js";
import { sweepOrphanedPendingPayments } from "./lib/sweep.js";
import { log } from "./log.js";
import { reconcile } from "./reconcile.js";

export { createApp } from "./app.js";
export { reconcile, applyEvent } from "./reconcile.js";
export type { Env } from "./env.js";

const app = createApp();

/** Run one reconcile pass from the scheduled handler, swallowing errors into the log (cron retries). */
async function runScheduled(env: Env): Promise<void> {
  try {
    const config = resolveConfig(env);
    const reader = new ViemChainReader(config);
    await reconcile(getDb(env), reader, config);
  } catch (err) {
    log.error("scheduled_failed", { message: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Prune abandoned `pending_payment` drafts (ADR-0032). Moved here from the deleted v1 frame Worker
 * (ADR-0042); it was never frame-specific — the web app also mints a draft before the paying tx
 * (chain-first, ADR-0027), so an asker who abandons mid-flow leaves a row no event will ever match.
 *
 * Deliberately kept OUT of `runScheduled`: a sweep failure must never stop reconcile, which is the
 * money-state writer. Runs on the hourly cron only, so a two-minute reconcile tick does no extra
 * work.
 */
async function runSweep(env: Env): Promise<void> {
  try {
    const result = await sweepOrphanedPendingPayments(getDb(env), {
      olderThanSeconds: orphanTtlSeconds(env),
    });
    if (result.deleted > 0) log.info("orphan_sweep", { deleted: result.deleted });
  } catch (err) {
    log.error("orphan_sweep_failed", { message: err instanceof Error ? err.message : String(err) });
  }
}

/** Cron minute that owns the hourly sweep; every other tick is reconcile-only. */
const SWEEP_CRON = "17 * * * *";

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Two crons share this handler; `cron` says which fired. The hourly one ALSO reconciles, so a
    // sweep tick is never a gap in money-state indexing.
    ctx.waitUntil(runScheduled(env));
    if (controller.cron === SWEEP_CRON) ctx.waitUntil(runSweep(env));
  },
};
