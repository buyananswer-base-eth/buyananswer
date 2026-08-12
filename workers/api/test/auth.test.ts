// SPDX-License-Identifier: MIT
// SIWE auth: health, happy-path login, single-use nonce (replay rejected), domain binding,
// unsupported chain, and the unauthenticated guard.

import { createSiweMessage } from "viem/siwe";
import { describe, expect, it } from "vitest";
import {
  ALICE_PK,
  DOMAIN,
  ORIGIN,
  account,
  login,
  postJson,
  readBody,
  request,
} from "./helpers.js";

describe("health", () => {
  it("GET /health is ok", async () => {
    const res = await request("/health");
    expect(res.status).toBe(200);
    expect(await readBody(res)).toEqual({ ok: true, service: "buyananswer-api", ready: true });
  });
});

describe("SIWE auth", () => {
  it("signs in and returns the recovered wallet, then /me reflects the session", async () => {
    const { res, cookie, address } = await login(ALICE_PK);
    expect(res.status).toBe(200);
    expect(await readBody(res)).toEqual({ wallet: address });
    expect(cookie).toMatch(/^ba_session=/);

    const me = await request("/me", {}, cookie);
    expect(me.status).toBe(200);
    expect(await readBody(me)).toEqual({ wallet: address, creator: null });
  });

  it("rejects a replayed nonce (single-use)", async () => {
    const acct = account(ALICE_PK);
    const nonceRes = await request("/auth/nonce", { method: "POST" });
    const { nonce } = (await readBody(nonceRes)) as { nonce: string };
    const message = createSiweMessage({
      address: acct.address,
      chainId: 84532,
      domain: DOMAIN,
      nonce,
      uri: `${ORIGIN}/login`,
      version: "1",
    });
    const signature = await acct.signMessage({ message });

    const first = await postJson("/auth/verify", { message, signature });
    expect(first.status).toBe(200);

    // Same nonce again → consumed → rejected.
    const second = await postJson("/auth/verify", { message, signature });
    expect(second.status).toBe(401);
    expect((await readBody(second)).error).toBe("invalid_nonce");
  });

  it("rejects a message bound to a different domain", async () => {
    const { res } = await login(ALICE_PK, { domain: "evil.example" });
    expect(res.status).toBe(401);
    const payload = (await readBody(res)) as { error: string; message?: string };
    expect(payload.error).toBe("siwe_failed");
    expect(payload.message).toBe("invalid_message");
  });

  it("rejects an unsupported chain id", async () => {
    const { res } = await login(ALICE_PK, { chainId: 1 });
    expect(res.status).toBe(401);
    expect((await readBody(res)).message).toBe("unsupported_chain");
  });

  it("rejects a nonce that was never issued", async () => {
    const acct = account(ALICE_PK);
    const message = createSiweMessage({
      address: acct.address,
      chainId: 84532,
      domain: DOMAIN,
      nonce: "neverissuednonce12345",
      uri: `${ORIGIN}/login`,
      version: "1",
    });
    const signature = await acct.signMessage({ message });
    const res = await postJson("/auth/verify", { message, signature });
    expect(res.status).toBe(401);
    expect((await readBody(res)).error).toBe("invalid_nonce");
  });

  it("GET /me without a session is 401", async () => {
    const res = await request("/me");
    expect(res.status).toBe(401);
    expect((await readBody(res)).error).toBe("unauthorized");
  });

  it("logout clears the session", async () => {
    const { cookie } = await login(ALICE_PK);
    const out = await request("/auth/logout", { method: "POST" }, cookie);
    expect(out.status).toBe(200);
    // The old cookie no longer resolves to a session.
    const me = await request("/me", {}, cookie);
    expect(me.status).toBe(401);
  });
});
