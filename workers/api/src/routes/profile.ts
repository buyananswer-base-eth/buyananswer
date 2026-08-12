// SPDX-License-Identifier: MIT
// Identity + profile routes (all require a session; authz is implicit — every query is keyed by the
// session wallet, so a wallet can only ever read/write its own profile):
//   GET  /me            — the signed-in wallet + its creator profile (or null).
//   POST /handle/claim  — create the creator profile with a unique, non-reserved handle.
//   PUT  /profile       — edit the owner's profile fields.

import { type NewCreator, type UsdcBaseUnits, creators } from "@buyananswer/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { requireAuth } from "../auth/middleware.js";
import type { AppContext } from "../env.js";
import { presentOwnerCreator } from "../lib/creator.js";
import { getDb, isUniqueViolation } from "../lib/db.js";
import { isReservedHandle } from "../lib/handles.js";
import { ApiError, readJson } from "../lib/http.js";
import { LIMITS, ipLimit } from "../lib/limits.js";
import { claimBody, profileBody } from "../schemas.js";

export const profileRoutes = new Hono<AppContext>();

profileRoutes.get("/me", requireAuth, async (c) => {
  const wallet = c.get("wallet");
  const creator = await getDb(c.env)
    .select()
    .from(creators)
    .where(eq(creators.wallet, wallet))
    .get();
  return c.json({ wallet, creator: creator ? presentOwnerCreator(creator) : null });
});

profileRoutes.post("/handle/claim", ipLimit(LIMITS.handleClaim), requireAuth, async (c) => {
  const wallet = c.get("wallet");
  const body = claimBody.parse(await readJson(c));
  if (isReservedHandle(body.handle)) {
    throw new ApiError(409, "handle_reserved", "that handle is reserved");
  }

  const db = getDb(c.env);
  const existing = await db.select().from(creators).where(eq(creators.wallet, wallet)).get();
  if (existing) {
    throw new ApiError(409, "already_claimed", "this wallet already has a profile");
  }

  const row: NewCreator = {
    wallet,
    handle: body.handle,
    displayName: body.displayName ?? body.handle,
    minPriceUsdc: (body.minPriceUsdc ?? "1000000") as UsdcBaseUnits,
  };
  try {
    const created = await db.insert(creators).values(row).returning().get();
    c.get("log").audit("handle_claim", { wallet, handle: created.handle });
    return c.json({ creator: presentOwnerCreator(created) }, 201);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, "handle_taken", "that handle is taken");
    throw err;
  }
});

profileRoutes.put("/profile", ipLimit(LIMITS.profileUpdate), requireAuth, async (c) => {
  const wallet = c.get("wallet");
  const body = profileBody.parse(await readJson(c));

  const db = getDb(c.env);
  const existing = await db.select().from(creators).where(eq(creators.wallet, wallet)).get();
  if (!existing) throw new ApiError(404, "no_profile", "claim a handle first");

  const patch: Partial<NewCreator> = { updatedAt: new Date() };
  if (body.displayName !== undefined) patch.displayName = body.displayName;
  if (body.headline !== undefined) patch.headline = body.headline;
  if (body.bio !== undefined) patch.bio = body.bio;
  if (body.minPriceUsdc !== undefined) patch.minPriceUsdc = body.minPriceUsdc as UsdcBaseUnits;
  if (body.links !== undefined)
    patch.links = body.links === null ? null : JSON.stringify(body.links);

  const updated = await db
    .update(creators)
    .set(patch)
    .where(eq(creators.wallet, wallet))
    .returning()
    .get();
  c.get("log").audit("profile_update", { wallet, fields: Object.keys(body) });
  return c.json({ creator: presentOwnerCreator(updated) });
});
