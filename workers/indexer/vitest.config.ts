// SPDX-License-Identifier: MIT
// Runs the indexer tests inside a real workerd + Miniflare runtime (D1) via
// @cloudflare/vitest-pool-workers, so the reconcile logic writes to the same D1 binding production
// uses. The shared Drizzle migrations are read here and applied per test file by
// ./test/apply-migrations.ts. There is NO live RPC — tests drive reconcile with a mocked ChainReader.

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
            // TEST_MIGRATIONS is applied to env.DB in the setup file. RECONCILE_TOKEN lets the HTTP
            // tests exercise the /reconcile auth gate (they only ever send a WRONG/absent bearer, so
            // no test triggers a real reconcile / network call).
            bindings: { TEST_MIGRATIONS: migrations, RECONCILE_TOKEN: "test-token" },
          },
        },
      },
    },
  };
});
