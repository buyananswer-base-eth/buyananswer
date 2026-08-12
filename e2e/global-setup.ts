// SPDX-License-Identifier: MIT
// Runs once before the tests: migrate + seed the API Worker's LOCAL D1 (the same .wrangler state the
// `wrangler dev` servers then read), so the board journey has the seeded `satoshi` / `vitalik` creators.
// Idempotent (the seed is INSERT OR IGNORE). Skipped when driving an external stack (E2E_BASE_URL set).
//
// On a live-chain run (on-chain spec / multi-actor harness) the API and the indexer are booted against
// ONE shared Miniflare state dir, so the migrations have to land there too — otherwise the indexer
// would reconcile into a database nobody reads (see SHARED_PERSIST_DIR).
//
// The indexer's `.dev.vars` is written from `playwright.config.ts` instead: `wrangler dev` reads that
// file at startup, which happens before this hook.

import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SHARED_PERSIST_DIR, liveChainRun } from "./harness/env";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const fixturesSql = fileURLToPath(new URL("./harness/live-chain-fixtures.sql", import.meta.url));

export default async function globalSetup(): Promise<void> {
  const run = (cmd: string) => execSync(cmd, { cwd: rootDir, stdio: "inherit" });
  // These use `wrangler ... --local`, which persists to the same dir `wrangler dev` reads from. On a
  // live-chain run we call wrangler directly so `--persist-to` reaches it (pnpm doesn't forward extra
  // args through `pnpm --filter <pkg> <script>`); otherwise the package scripts stay the entry point.
  const api = "pnpm --filter @buyananswer/api";
  if (liveChainRun) {
    const to = `--local --persist-to ${SHARED_PERSIST_DIR}`;
    run(`${api} exec wrangler d1 migrations apply buyananswer-dev ${to}`);
    run(`${api} exec wrangler d1 execute buyananswer-dev ${to} --file=./seed/seed.dev.sql`);
    // …then drop the fixture questions. The seed itself no longer squats on real (chain_id, onchain_id)
    // pairs (Session 18), but the shared state dir outlives a run, so a database seeded before that fix
    // still carries them — and a live-chain run should assert against the chain, not fabricated
    // money-state. A no-op on a fresh seed. See the SQL file.
    run(`${api} exec wrangler d1 execute buyananswer-dev ${to} --file=${fixturesSql}`);
  } else {
    run(`${api} db:migrate:local`);
    run(`${api} db:seed:local`);
  }
}
