// SPDX-License-Identifier: MIT
// Public board reads: correct shape, no private fields leaked, and 404s for unknown/malformed handles.

import { describe, expect, it } from "vitest";
import { ALICE_PK, login, postJson, readBody, request } from "./helpers.js";

describe("GET /board/:handle", () => {
  it("returns the public profile with only the public field allowlist", async () => {
    const { cookie, address } = await login(ALICE_PK);
    await postJson(
      "/handle/claim",
      { handle: "alice", displayName: "Alice", minPriceUsdc: "5000000" },
      cookie,
    );

    const res = await request("/board/alice");
    expect(res.status).toBe(200);
    const { creator } = (await readBody(res)) as { creator: Record<string, unknown> };

    expect(creator).toEqual({
      wallet: address,
      handle: "alice",
      displayName: "Alice",
      headline: null,
      bio: null,
      avatarUrl: null,
      links: null,
      minPriceUsdc: "5000000",
      createdAt: expect.anything(),
    });
    // updatedAt is internal and must never be exposed on a public read.
    expect(creator).not.toHaveProperty("updatedAt");
  });

  it("is case-insensitive on the handle", async () => {
    const { cookie } = await login(ALICE_PK);
    await postJson("/handle/claim", { handle: "alice" }, cookie);
    const res = await request("/board/ALICE");
    expect(res.status).toBe(200);
    expect((await readBody(res)).creator.handle).toBe("alice");
  });

  it("404s an unknown handle", async () => {
    const res = await request("/board/ghost");
    expect(res.status).toBe(404);
    expect((await readBody(res)).error).toBe("not_found");
  });

  it("404s a malformed handle without a lookup", async () => {
    const res = await request("/board/has%20space");
    expect(res.status).toBe(404);
  });
});
