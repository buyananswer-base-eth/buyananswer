// SPDX-License-Identifier: MIT
// Public board read: GET /board/:handle — a creator's public profile, no auth, no private fields.

import { creators } from "@buyananswer/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppContext } from "../env.js";
import { presentPublicCreator } from "../lib/creator.js";
import { getDb } from "../lib/db.js";
import { HANDLE_REGEX, normalizeHandle } from "../lib/handles.js";
import { ApiError } from "../lib/http.js";

export const boardRoutes = new Hono<AppContext>();

boardRoutes.get("/board/:handle", async (c) => {
  const handle = normalizeHandle(c.req.param("handle"));
  // A malformed handle can never exist — 404 without touching the DB.
  if (!HANDLE_REGEX.test(handle)) throw new ApiError(404, "not_found");

  const creator = await getDb(c.env)
    .select()
    .from(creators)
    .where(eq(creators.handle, handle))
    .get();
  if (!creator) throw new ApiError(404, "not_found");

  return c.json({ creator: presentPublicCreator(creator) });
});
