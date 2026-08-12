// SPDX-License-Identifier: MIT
// Authorization: profile edits are server-side scoped to the session wallet. A wallet can only ever
// edit its own profile — there is no route parameter to target another creator — and Bob's edits
// never touch Alice's row.

import { describe, expect, it } from "vitest";
import { ALICE_PK, BOB_PK, login, postJson, readBody, request } from "./helpers.js";

async function claim(pk: `0x${string}`, handle: string) {
  const session = await login(pk);
  const res = await postJson("/handle/claim", { handle }, session.cookie);
  expect(res.status).toBe(201);
  return session;
}

describe("profile authz", () => {
  it("PUT /profile edits only the session wallet's own profile", async () => {
    const alice = await claim(ALICE_PK, "alice");
    const bob = await claim(BOB_PK, "bob");

    // Bob updates his profile.
    const bobPut = await request(
      "/profile",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: "Bob Edited", headline: "hi" }),
      },
      bob.cookie,
    );
    expect(bobPut.status).toBe(200);
    expect((await readBody(bobPut)).creator.displayName).toBe("Bob Edited");

    // Alice's profile is untouched by Bob's edit.
    const aliceMe = await request("/me", {}, alice.cookie);
    const aliceCreator = (await readBody(aliceMe)).creator;
    expect(aliceCreator.displayName).toBe("alice");
    expect(aliceCreator.headline).toBeNull();

    // The public boards confirm each wallet only changed its own.
    const bobBoard = await request("/board/bob");
    expect((await readBody(bobBoard)).creator.displayName).toBe("Bob Edited");
    const aliceBoard = await request("/board/alice");
    expect((await readBody(aliceBoard)).creator.displayName).toBe("alice");
  });

  it("PUT /profile requires a session", async () => {
    const res = await request("/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Anon" }),
    });
    expect(res.status).toBe(401);
  });

  it("PUT /profile before claiming a handle is 404", async () => {
    const { cookie } = await login(ALICE_PK);
    const res = await request(
      "/profile",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: "No Profile Yet" }),
      },
      cookie,
    );
    expect(res.status).toBe(404);
    expect((await readBody(res)).error).toBe("no_profile");
  });

  it("PUT /profile updates fields, links, and min price", async () => {
    const alice = await claim(ALICE_PK, "alice");
    const res = await request(
      "/profile",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bio: "Answering the hard ones.",
          minPriceUsdc: "5000000",
          links: [{ label: "site", url: "https://example.com" }],
        }),
      },
      alice.cookie,
    );
    expect(res.status).toBe(200);
    const creator = (await readBody(res)).creator;
    expect(creator.bio).toBe("Answering the hard ones.");
    expect(creator.minPriceUsdc).toBe("5000000");
    expect(creator.links).toEqual([{ label: "site", url: "https://example.com" }]);
  });

  it("PUT /profile rejects an out-of-range min price with 422", async () => {
    const alice = await claim(ALICE_PK, "alice");
    const res = await request(
      "/profile",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ minPriceUsdc: "1" }), // below 1 USDC (1e6)
      },
      alice.cookie,
    );
    expect(res.status).toBe(422);
  });

  it("PUT /profile rejects a non-http(s) link URL (stored-XSS guard, ADR-0035)", async () => {
    const alice = await claim(ALICE_PK, "alice");
    // A javascript: URL is a valid URL per the URL spec, so it must be blocked by scheme, not shape —
    // otherwise it would render as an href on the public board (BoardView) as a click-to-execute vector.
    const res = await request(
      "/profile",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          links: [{ label: "evil", url: "javascript:alert(document.cookie)" }],
        }),
      },
      alice.cookie,
    );
    expect(res.status).toBe(422);
  });
});
