// SPDX-License-Identifier: MIT
// Drizzle Kit config for generating D1 (SQLite) migrations from ./src/db/schema.ts.
// Generate with `pnpm --filter @buyananswer/shared db:generate`. Migrations are applied to a local
// (or remote) D1 by wrangler — see workers/api (`migrations_dir` points here). We deliberately do
// not configure a `dbCredentials`/`driver` here: migrations are applied by wrangler, not drizzle-kit
// push, so no account id or token is ever needed in this committed file.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./migrations",
  strict: true,
  verbose: true,
});
