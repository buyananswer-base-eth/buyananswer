// SPDX-License-Identifier: MIT
// Setup file: apply the shared D1 migrations to the test database before each test file runs.
// (Storage is isolated per file; applyD1Migrations is idempotent via the d1_migrations table.)

import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
