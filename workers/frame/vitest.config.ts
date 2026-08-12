// SPDX-License-Identifier: MIT
// Runs the frame tests inside a real workerd + Miniflare runtime (D1) via
// @cloudflare/vitest-pool-workers, so the mint logic writes to the same D1 binding production uses.
// The shared Drizzle migrations are read here and applied per test file by ./test/apply-migrations.ts.
// There is NO live Farcaster hub — tests inject a fake FrameVerifier (never a network call).

import { fileURLToPath } from "node:url";
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

const migrationsDir = fileURLToPath(new URL("../../packages/shared/migrations", import.meta.url));

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(migrationsDir);

  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          singleWorker: true,
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            // TEST_MIGRATIONS is applied to env.DB in the setup file. FRAME_HUB_URL is left as the
            // wrangler.jsonc default, but tests inject a fake verifier so the hub is never called.
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
