// SPDX-License-Identifier: MIT
// Shared test helpers: drive the Worker via app.fetch with the Miniflare env, and perform a real
// SIWE login with a local viem account (EOA signing, no RPC).

import { env } from "cloudflare:test";
import { type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import app from "../src/index.js";

/** The domain the test Worker is served on; SIWE messages must bind to it. */
export const DOMAIN = "example.com";
export const ORIGIN = `https://${DOMAIN}`;
export const CHAIN_ID = 84532; // Base Sepolia

// Deterministic dev keys (Anvil accounts #0 and #1) — testnet only, never funded on mainnet.
export const ALICE_PK =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
export const BOB_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

export function account(pk: `0x${string}`): PrivateKeyAccount {
  return privateKeyToAccount(pk);
}

/** Fetch a path on the Worker with the Miniflare bindings, optionally attaching a session cookie. */
export async function request(
  path: string,
  init: RequestInit = {},
  cookie?: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  return app.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env);
}

/** Parse a JSON response body. `Response.json()` is typed `unknown`; callers know the shape. */
// biome-ignore lint/suspicious/noExplicitAny: test bodies are dynamically shaped assertions
export function readBody<T = Record<string, any>>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

/** POST a JSON body. */
export function postJson(path: string, body: unknown, cookie?: string): Promise<Response> {
  return request(
    path,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    cookie,
  );
}

/** Extract the `ba_session` cookie value from a response's Set-Cookie header. */
export function sessionCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  const token = /ba_session=([^;]+)/.exec(setCookie)?.[1];
  return token ? `ba_session=${token}` : "";
}

export interface LoginOptions {
  /** Override the domain baked into the SIWE message (to test domain-binding rejection). */
  domain?: string;
  /** Override the chain id (to test unsupported-chain rejection). */
  chainId?: number;
}

export interface LoginResult {
  res: Response;
  cookie: string;
  address: `0x${string}`;
}

/** Full SIWE login for an account: nonce → sign → verify. Returns the session cookie. */
export async function login(pk: `0x${string}`, opts: LoginOptions = {}): Promise<LoginResult> {
  const acct = account(pk);
  const nonceRes = await request("/auth/nonce", { method: "POST" });
  const { nonce } = (await nonceRes.json()) as { nonce: string };

  const message = createSiweMessage({
    address: acct.address,
    chainId: opts.chainId ?? CHAIN_ID,
    domain: opts.domain ?? DOMAIN,
    nonce,
    uri: `${ORIGIN}/login`,
    version: "1",
    statement: "Sign in to BuyAnAnswer",
  });
  const signature = await acct.signMessage({ message });

  const res = await postJson("/auth/verify", { message, signature });
  return {
    res,
    cookie: sessionCookie(res),
    address: acct.address.toLowerCase() as `0x${string}`,
  };
}
