// SPDX-License-Identifier: MIT
// Give the local indexer the two secrets it needs for a live-chain run: the Base Sepolia RPC and the
// `POST /reconcile` bearer. Without them it reads no chain and the reconcile endpoint is disabled
// (fail-closed), so no money-state would ever move and every money path would stall.
//
// This runs from `playwright.config.ts` — i.e. while the config module is evaluated, BEFORE Playwright
// launches any `webServer` — because `wrangler dev` reads `.dev.vars` at startup. `.dev.vars` is
// git-ignored repo-wide; existing keys in it are preserved.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../..", import.meta.url));

/** Set `key=value`, keeping every other line already in the file. */
function upsert(path: string, key: string, value: string): void {
  const existing = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  const kept = existing.filter(
    (line) => line.trim() !== "" && !new RegExp(`^\\s*${key}\\s*=`).test(line),
  );
  writeFileSync(path, `${[...kept, `${key}=${value}`].join("\n")}\n`);
}

/** Returns true when the indexer is now configured for a live Base Sepolia run. */
export function configureIndexerDevVars(): boolean {
  const rpc = process.env.E2E_RPC_URL?.trim();
  const token = process.env.E2E_RECONCILE_TOKEN?.trim();
  if (!rpc || !token) return false; // the specs skip with their own clear message
  const path = `${rootDir}workers/indexer/.dev.vars`;
  upsert(path, "RPC_URL_BASE_SEPOLIA", rpc);
  upsert(path, "RECONCILE_TOKEN", token);
  return true;
}
