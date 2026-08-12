// SPDX-License-Identifier: MIT
// Worker entrypoint for @buyananswer/indexer. Exports a module with both a `fetch` handler (the Hono
// app: /health + POST /reconcile) and a `scheduled` handler (the Cron Trigger that reconciles on an
// interval). The reconcile core is exported for tests, which drive it with a mocked ChainReader.

import { createApp } from "./app.js";
import { ViemChainReader } from "./chain.js";
import { getDb } from "./db.js";
import { type Env, resolveConfig } from "./env.js";
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

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(env));
  },
};
