// SPDX-License-Identifier: MIT
// Avatar upload + serve:
//   POST /avatar               — owner-only raw image upload → R2 → writes creators.avatar_url.
//   GET  /avatars/:wallet/:file — serve an avatar object from R2 (used when no public bucket URL).
//
// The upload is a raw body (Content-Type set by the client). We enforce the declared type, the size
// (≤ 5 MB), AND that the actual bytes match the declared type (magic-number sniff) — never trust the
// header alone (FUNCTIONAL_SPEC §3.1).

import { creators } from "@buyananswer/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { requireAuth } from "../auth/middleware.js";
import { randomToken } from "../auth/session.js";
import type { AppContext } from "../env.js";
import { presentOwnerCreator } from "../lib/creator.js";
import { getDb } from "../lib/db.js";
import { ApiError } from "../lib/http.js";
import {
  AVATAR_CONTENT_TYPES,
  MAX_AVATAR_BYTES,
  isAvatarContentType,
  sniffImageType,
} from "../lib/images.js";
import { LIMITS, ipLimit } from "../lib/limits.js";

export const avatarRoutes = new Hono<AppContext>();

avatarRoutes.post("/avatar", ipLimit(LIMITS.avatarUpload), requireAuth, async (c) => {
  const wallet = c.get("wallet");

  const declared = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!isAvatarContentType(declared)) {
    throw new ApiError(
      415,
      "unsupported_media_type",
      "avatar must be image/png, image/jpeg or image/webp",
    );
  }

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) throw new ApiError(400, "empty_body", "no image bytes");
  if (body.byteLength > MAX_AVATAR_BYTES) {
    throw new ApiError(413, "file_too_large", "avatar must be ≤ 5 MB");
  }

  const sniffed = sniffImageType(new Uint8Array(body));
  if (sniffed !== declared) {
    throw new ApiError(400, "invalid_image", "image bytes do not match the declared content type");
  }

  const db = getDb(c.env);
  const existing = await db.select().from(creators).where(eq(creators.wallet, wallet)).get();
  if (!existing) throw new ApiError(404, "no_profile", "claim a handle first");

  const ext = AVATAR_CONTENT_TYPES[declared];
  const key = `avatars/${wallet}/${randomToken().slice(0, 32)}.${ext}`;
  await c.env.AVATARS.put(key, body, { httpMetadata: { contentType: declared } });

  const base = c.env.AVATAR_PUBLIC_BASE_URL?.trim();
  const url = base
    ? `${base.replace(/\/+$/, "")}/${key}`
    : new URL(`/${key}`, c.req.url).toString();

  const updated = await db
    .update(creators)
    .set({ avatarUrl: url, updatedAt: new Date() })
    .where(eq(creators.wallet, wallet))
    .returning()
    .get();
  c.get("log").audit("avatar_upload", { wallet, key });
  return c.json({ avatarUrl: url, creator: presentOwnerCreator(updated) });
});

avatarRoutes.get("/avatars/:wallet/:file", async (c) => {
  const key = `avatars/${c.req.param("wallet")}/${c.req.param("file")}`;
  const object = await c.env.AVATARS.get(key);
  if (!object) throw new ApiError(404, "not_found");

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=3600");
  // Buffer the (≤ 5 MB) object rather than streaming R2's body: this Worker route is a fallback for
  // when no public bucket URL is configured, and a fully-read body avoids dangling read handles.
  return new Response(await object.arrayBuffer(), { headers });
});
