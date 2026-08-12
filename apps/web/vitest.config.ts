// SPDX-License-Identifier: MIT
// Vitest picks up this config in preference to vite.config.ts, so tests run WITHOUT the React Router
// plugin (which expects the framework build context). Session-9 tests cover pure logic — the SIWE
// message builder and the chain-guard helpers — so a plain Node environment is all we need.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "app/**/*.test.ts"],
  },
});
