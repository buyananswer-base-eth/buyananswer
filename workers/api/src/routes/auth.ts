// SPDX-License-Identifier: MIT
// SIWE auth routes: nonce → verify → logout.
//   POST /auth/nonce  — issue a single-use nonce (stored in KV with a short TTL).
//   POST /auth/verify — validate the SIWE message + signature, consume the nonce, open a session.
//   POST /auth/logout — destroy the session + clear the cookie.

import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { generateSiweNonce, parseSiweMessage } from "viem/siwe";
import { consumeNonce, createSession, destroySession, issueNonce } from "../auth/session.js";
import { verifySiwe } from "../auth/siwe.js";
import type { AppContext } from "../env.js";
import {
  NONCE_TTL_SECONDS,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  rpcUrlForChain,
  ttlFromEnv,
} from "../env.js";
import { ApiError, readJson } from "../lib/http.js";
import { LIMITS, ipLimit } from "../lib/limits.js";
import { verifyBody } from "../schemas.js";

export const authRoutes = new Hono<AppContext>();

authRoutes.post("/nonce", ipLimit(LIMITS.authNonce), async (c) => {
  const nonce = generateSiweNonce();
  await issueNonce(c.env.SESSIONS, nonce, ttlFromEnv(c.env.NONCE_TTL_SECONDS, NONCE_TTL_SECONDS));
  return c.json({ nonce });
});

authRoutes.post("/verify", ipLimit(LIMITS.authVerify), async (c) => {
  const { message, signature } = verifyBody.parse(await readJson(c));

  const fields = parseSiweMessage(message);
  if (!fields.nonce) throw new ApiError(400, "missing_nonce");

  // Consume the nonce first: a single-use nonce can never be replayed, even on a failed verify.
  const fresh = await consumeNonce(c.env.SESSIONS, fields.nonce);
  if (!fresh) throw new ApiError(401, "invalid_nonce", "nonce unknown, expired, or already used");

  // Bind the exact domain the request was served on.
  const domain = new URL(c.req.url).host;
  const result = await verifySiwe({
    message,
    signature: signature as `0x${string}`,
    domain,
    nonce: fields.nonce,
    // Only consulted when the signature is not a recoverable EOA one — i.e. a smart wallet
    // (ERC-1271/6492). EOA sign-in never touches the network (ADR-0039).
    rpcUrl: fields.chainId ? rpcUrlForChain(c.env, fields.chainId) : undefined,
  });
  if (!result.ok) throw new ApiError(401, "siwe_failed", result.error);

  const ttl = ttlFromEnv(c.env.SESSION_TTL_SECONDS, SESSION_TTL_SECONDS);
  const token = await createSession(c.env.SESSIONS, result.address, ttl);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: ttl,
  });
  c.get("log").audit("login", { wallet: result.address });
  return c.json({ wallet: result.address });
});

authRoutes.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await destroySession(c.env.SESSIONS, token);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  c.get("log").audit("logout", {});
  return c.json({ ok: true });
});
