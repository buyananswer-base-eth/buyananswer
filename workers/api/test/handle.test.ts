// SPDX-License-Identifier: MIT
// Handle claim: happy path, uniqueness (clean 409), reserved names, already-claimed, and validation.

import { describe, expect, it } from "vitest";
import { ALICE_PK, BOB_PK, login, postJson, readBody, request } from "./helpers.js";

describe("POST /handle/claim", () => {
  it("claims a handle and creates the profile", async () => {
    const { cookie, address } = await login(ALICE_PK);
    const res = await postJson("/handle/claim", { handle: "alice", displayName: "Alice" }, cookie);
    expect(res.status).toBe(201);
    const { creator } = (await readBody(res)) as { creator: { handle: string; wallet: string } };
    expect(creator.handle).toBe("alice");
    expect(creator.wallet).toBe(address);

    // /me now returns the profile.
    const me = await request("/me", {}, cookie);
    expect((await readBody(me)).creator.handle).toBe("alice");
  });

  it("lowercases the handle before storing", async () => {
    const { cookie } = await login(ALICE_PK);
    const res = await postJson("/handle/claim", { handle: "AliceCooper" }, cookie);
    expect(res.status).toBe(201);
    expect((await readBody(res)).creator.handle).toBe("alicecooper");
  });

  it("rejects a duplicate handle with a clean 409", async () => {
    const alice = await login(ALICE_PK);
    const first = await postJson("/handle/claim", { handle: "shared" }, alice.cookie);
    expect(first.status).toBe(201);

    const bob = await login(BOB_PK);
    const second = await postJson("/handle/claim", { handle: "shared" }, bob.cookie);
    expect(second.status).toBe(409);
    expect((await readBody(second)).error).toBe("handle_taken");
  });

  it("rejects reserved handles", async () => {
    const { cookie } = await login(ALICE_PK);
    for (const handle of ["admin", "api", "board", "settings"]) {
      const res = await postJson("/handle/claim", { handle }, cookie);
      expect(res.status).toBe(409);
      expect((await readBody(res)).error).toBe("handle_reserved");
    }
  });

  it("rejects a second claim by the same wallet", async () => {
    const { cookie } = await login(ALICE_PK);
    expect((await postJson("/handle/claim", { handle: "first" }, cookie)).status).toBe(201);
    const again = await postJson("/handle/claim", { handle: "second" }, cookie);
    expect(again.status).toBe(409);
    expect((await readBody(again)).error).toBe("already_claimed");
  });

  it("rejects an invalid handle with 422", async () => {
    const { cookie } = await login(ALICE_PK);
    for (const handle of ["ab", "has space", "no-dashes", "waytoolongwaytoolongwaytoolongxx"]) {
      const res = await postJson("/handle/claim", { handle }, cookie);
      expect(res.status).toBe(422);
      expect((await readBody(res)).error).toBe("validation_error");
    }
  });

  it("requires a session", async () => {
    const res = await postJson("/handle/claim", { handle: "nobody" });
    expect(res.status).toBe(401);
  });
});
