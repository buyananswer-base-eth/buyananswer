// SPDX-License-Identifier: MIT
// Avatar upload validation: type + size enforced, bytes must match the declared type, owner-only,
// and the stored object is retrievable and writes creators.avatar_url.

import { describe, expect, it } from "vitest";
import { MAX_AVATAR_BYTES } from "../src/lib/images.js";
import { ALICE_PK, login, postJson, readBody, request } from "./helpers.js";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function image(magic: number[], totalBytes = 64): Uint8Array {
  const bytes = new Uint8Array(totalBytes);
  bytes.set(magic, 0);
  return bytes;
}

function uploadAvatar(body: BodyInit, contentType: string, cookie?: string): Promise<Response> {
  return request(
    "/avatar",
    { method: "POST", headers: { "content-type": contentType }, body },
    cookie,
  );
}

async function claimedSession() {
  const session = await login(ALICE_PK);
  await postJson("/handle/claim", { handle: "alice" }, session.cookie);
  return session;
}

describe("POST /avatar", () => {
  it("accepts a valid PNG, writes avatar_url, and serves the object", async () => {
    const { cookie } = await claimedSession();
    const res = await uploadAvatar(image(PNG_MAGIC), "image/png", cookie);
    expect(res.status).toBe(200);
    const body = (await readBody(res)) as { avatarUrl: string; creator: { avatarUrl: string } };
    expect(body.avatarUrl).toContain("/avatars/");
    expect(body.creator.avatarUrl).toBe(body.avatarUrl);

    // The stored object is retrievable at its URL with the right content type.
    const path = new URL(body.avatarUrl).pathname;
    const got = await request(path);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect((await got.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("rejects an unsupported content type with 415", async () => {
    const { cookie } = await claimedSession();
    const res = await uploadAvatar(image(PNG_MAGIC), "image/gif", cookie);
    expect(res.status).toBe(415);
    expect((await readBody(res)).error).toBe("unsupported_media_type");
  });

  it("rejects a file larger than 5 MB with 413", async () => {
    const { cookie } = await claimedSession();
    const res = await uploadAvatar(image(PNG_MAGIC, MAX_AVATAR_BYTES + 1), "image/png", cookie);
    expect(res.status).toBe(413);
    expect((await readBody(res)).error).toBe("file_too_large");
  });

  it("rejects bytes that do not match the declared content type with 400", async () => {
    const { cookie } = await claimedSession();
    // Declares PNG but sends JPEG bytes.
    const res = await uploadAvatar(image(JPEG_MAGIC), "image/png", cookie);
    expect(res.status).toBe(400);
    expect((await readBody(res)).error).toBe("invalid_image");
  });

  it("rejects an empty body with 400", async () => {
    const { cookie } = await claimedSession();
    const res = await uploadAvatar(new Uint8Array(0), "image/png", cookie);
    expect(res.status).toBe(400);
    expect((await readBody(res)).error).toBe("empty_body");
  });

  it("requires a session", async () => {
    const res = await uploadAvatar(image(PNG_MAGIC), "image/png");
    expect(res.status).toBe(401);
  });

  it("requires a claimed profile (404 otherwise)", async () => {
    const { cookie } = await login(ALICE_PK); // logged in but no handle claimed
    const res = await uploadAvatar(image(PNG_MAGIC), "image/png", cookie);
    expect(res.status).toBe(404);
    expect((await readBody(res)).error).toBe("no_profile");
  });
});
