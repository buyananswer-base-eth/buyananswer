// SPDX-License-Identifier: MIT
// Types the `cloudflare:test` env with our Worker bindings plus the test-only migrations binding.

import type { D1Migration } from "cloudflare:test";
import type { Env } from "../src/env.js";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    /** Shared Drizzle migrations, injected by vitest.config.ts and applied in apply-migrations.ts. */
    TEST_MIGRATIONS: D1Migration[];
  }
}
