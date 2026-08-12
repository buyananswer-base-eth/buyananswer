// SPDX-License-Identifier: MIT
// Worker entrypoint for @buyananswer/api. The default export is the Hono app (a valid Workers
// module fetch handler); wrangler serves it. Env/app helpers are re-exported for tests + consumers.

import { createApp } from "./app.js";

export type { Env } from "./env.js";
export { createApp } from "./app.js";

const app = createApp();

export default app;
