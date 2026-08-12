// SPDX-License-Identifier: MIT
// Playwright config for the BuyAnAnswer end-to-end suite (Session 15 / ADR-0034).
//
// Runs the app the way a user does: the SSR web app + the real API Worker (+ the indexer for the
// on-chain journey), booted as Playwright `webServer`s from the monorepo root. globalSetup migrates +
// seeds the local D1 first. Point E2E_BASE_URL at an already-running/deployed stack to skip all of that.
//
// The heavy browser toolchain lives ONLY in this standalone package (not the workspace), so the fast
// per-PR `node` CI job never installs it. The on-chain journey is gated on E2E_ONCHAIN + secrets; the
// Session-17 multi-actor harness (E2E_HARNESS=1, `pnpm run test:harness`) needs the same live stack.

import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
// Side-effect import: loads `e2e/.env` (shell vars always win) so the documented on-chain/harness
// secrets actually reach the run — Playwright itself doesn't read .env files.
import { SHARED_PERSIST_DIR, liveChainRun, loadDotEnv } from "./harness/env";
import { configureIndexerDevVars } from "./harness/indexer-vars";

loadDotEnv();

const rootDir = fileURLToPath(new URL("..", import.meta.url));

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
const API_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:8787";
const INDEXER_URL = process.env.E2E_INDEXER_URL ?? "http://127.0.0.1:8788";
// Both the gated on-chain spec and the multi-actor harness need the indexer running against the chain.
const onchain = liveChainRun;
// `wrangler dev` reads .dev.vars at startup, so this must happen here — before the webServers launch.
if (onchain) configureIndexerDevVars();
// When driving an external stack we manage no servers and skip the migrate/seed setup.
const external = Boolean(process.env.E2E_BASE_URL);

// On a live-chain run the API and the indexer must share ONE local D1 — see SHARED_PERSIST_DIR.
const persist = onchain ? ` --persist-to ${SHARED_PERSIST_DIR}` : "";

const server = (command: string, url: string) => ({
  command,
  url,
  cwd: rootDir,
  timeout: 180_000,
  // Never reuse a stray dev server on a LIVE-CHAIN run. Reuse ignores the flags we boot with, so an
  // API left running from an earlier session (without `--persist-to`) silently writes drafts to a
  // different D1 than the indexer reads — the question is escrowed on-chain but never leaves
  // `pending_payment`, which looks like an indexer bug and isn't. Better to fail on a busy port.
  reuseExistingServer: !process.env.CI && !onchain,
  stdout: "pipe" as const,
  stderr: "pipe" as const,
});

const localServers = [
  server(
    `pnpm --filter @buyananswer/api dev --ip 127.0.0.1 --port 8787${persist}`,
    `${API_URL}/health`,
  ),
  server("pnpm --filter @buyananswer/web dev --host 127.0.0.1 --port 5173", BASE_URL),
];
// The indexer is only needed to flip pending_payment → open, i.e. for the on-chain journey.
const indexerServer = server(
  `pnpm --filter @buyananswer/indexer dev --ip 127.0.0.1 --port 8788${persist}`,
  `${INDEXER_URL}/health`,
);

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1, // the local stack + rate limits (ADR-0032) prefer serial runs
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: external ? undefined : "./global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  webServer: external ? undefined : onchain ? [...localServers, indexerServer] : localServers,
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
