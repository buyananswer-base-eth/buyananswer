// SPDX-License-Identifier: MIT
// Runs the API tests inside a real workerd + Miniflare runtime (D1/KV/R2) via
// @cloudflare/vitest-pool-workers, so tests exercise the same bindings production uses. The shared
// Drizzle migrations are read here and applied per test file by ./test/apply-migrations.ts.

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
            // Surfaced to tests as env.TEST_MIGRATIONS; applied to env.DB in the setup file.
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
