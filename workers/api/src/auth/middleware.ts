// SPDX-License-Identifier: MIT
// requireAuth — resolves the session cookie to a wallet and puts it on the context, or 401s.
// Every mutation route mounts this: authorization is server-side and never trusts the client.

import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppContext } from "../env.js";
import { SESSION_COOKIE } from "../env.js";
import { ApiError } from "../lib/http.js";
import { readSession } from "./session.js";

/** Require an authenticated session; sets `c.get("wallet")` or throws 401. */
export const requireAuth = createMiddleware<AppContext>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const wallet = token ? await readSession(c.env.SESSIONS, token) : null;
  if (!wallet) throw new ApiError(401, "unauthorized", "sign in with your wallet first");
  c.set("wallet", wallet);
  await next();
});
