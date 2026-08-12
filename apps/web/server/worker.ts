// SPDX-License-Identifier: MIT
// Cloudflare Workers entry for the web app (ADR-0038).
//
// Static assets are served by the `assets` binding declared in wrangler.jsonc BEFORE this Worker
// runs — Workers Static Assets only invokes the Worker when no built client file matches the path.
// So this handler only ever sees SSR routes (`/`, `/<handle>`, `/app`, `/ask/:handle`, …).
//
// `build/server/index.js` is a BUILD ARTIFACT produced by `pnpm --filter @buyananswer/web build`
// (git-ignored). Wrangler bundles it in at deploy time, so the build must run first — see
// the deploy runbook: build first, then `wrangler deploy --env production` from apps/web.

import { createRequestHandler } from "react-router";
import { proxyDecisionFor, rewritePath } from "../app/lib/api-proxy.js";
// @ts-expect-error — generated at build time by `react-router build`; no types are emitted for it.
import * as serverBuild from "../build/server/index.js";

/** Bindings + vars this Worker is deployed with (wrangler.jsonc `vars` / `wrangler secret`). */
export interface Env {
  /** Static-asset binding declared in wrangler.jsonc. Present but unused: assets are matched first. */
  ASSETS: Fetcher;
  /** Service binding to the API Worker — backs the same-origin `/api/*` proxy below. */
  API?: Fetcher;
  /** Origin the SSR board loader calls for the PUBLIC board read (the API Worker). */
  SSR_API_ORIGIN?: string;
  /** Canonical site origin for absolute OG/canonical URLs. */
  SITE_ORIGIN?: string;
}

const handleRequest = createRequestHandler(serverBuild, import.meta.env?.MODE ?? "production");

/**
 * Proxy browser API calls to the API Worker, preserving the ORIGINAL HOST.
 *
 * `app/lib/api.ts` calls the API same-origin under `/api/*`, and every call sends
 * `credentials: "include"`. Same-origin is not incidental — it is what makes the API's
 * HttpOnly/Secure/**SameSite=Lax** `ba_session` cookie usable at all (ADR-0022). Pointing the client
 * at `api.buyananswer.com` instead would make every call cross-site, and a Lax cookie is not sent on
 * cross-site requests, so sessions would silently never persist.
 *
 * In dev, Vite's proxy does this with `changeOrigin: false`. Production had NO equivalent until this
 * function existed — `/api/*` fell through to React Router and 404'd.
 *
 * Two details are load-bearing:
 *  • **The host is left untouched.** `POST /auth/verify` binds the SIWE `domain` to
 *    `new URL(c.req.url).host` (workers/api/src/routes/auth.ts). The client signs a message naming
 *    `window.location.host`. Rewriting the host here to the API's own hostname would make those
 *    disagree and every sign-in would fail the domain binding. A service binding does not resolve
 *    DNS, so keeping `buyananswer.com` as the host is both correct and free.
 *  • **The `/api` prefix is stripped**, matching Vite's `rewrite` — the API mounts its routes at the
 *    root (`/health`, `/auth/nonce`, …), not under `/api`.
 */
function proxyToApi(request: Request, env: Env, stripPrefix: boolean): Promise<Response> {
  if (!env.API) {
    return Promise.resolve(
      new Response(JSON.stringify({ error: "api_unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );
  }
  const url = new URL(request.url);
  url.pathname = rewritePath(url.pathname, stripPrefix);
  return env.API.fetch(new Request(url, request));
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // `app/lib/board.server.ts` reads SSR_API_ORIGIN / SITE_ORIGIN off `process.env`. With
    // `nodejs_compat` and a compatibility_date >= 2025-04-01, workerd populates `process.env` from
    // the Worker's vars and secrets automatically, so those reads resolve without code changes.
    // This assignment is a belt-and-braces fallback for any binding the runtime did not surface.
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string" && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }

    // Same-origin API proxy — must run BEFORE the router, which would otherwise render its SSR
    // catch-all for these paths (that was the original bug). The routing decision is a pure
    // function so it can be regression-tested: see app/lib/api-proxy.ts + test/api-proxy.test.ts.
    const decision = proxyDecisionFor(new URL(request.url).pathname);
    if (decision.proxy) return proxyToApi(request, env, decision.stripPrefix);

    return handleRequest(request, { cloudflare: { env, ctx } });
  },
} satisfies ExportedHandler<Env>;
