// SPDX-License-Identifier: MIT
// Session 19 — named regression for the SAME-ORIGIN API PROXY (ADR-0038).
//
// THE BUG THIS PINS: the production Cloudflare Worker shipped with no `/api/*` proxy. In dev, Vite
// proxies `/api/*` to the API Worker; production had no equivalent, so every API call fell through
// to React Router's SSR catch-all and came back as a 404 HTML page. The UI reported
// "Can't reach the server — the API isn't responding", which points at the API being down when in
// fact the request never left the web Worker. Nothing failed loudly at deploy time; typecheck,
// build and every unit test were green.
//
// Two properties are load-bearing and easy to break by "tidying" the matcher:
//   • `/api/*` MUST be stripped — the API mounts routes at the root (/health, /auth/nonce, …).
//   • `/avatars/*` MUST NOT be stripped — the API serves R2 objects at that literal path and stored
//     avatar_url values already embed it.
// The host is preserved by the Worker (not modelled here) because POST /auth/verify binds the SIWE
// domain to the request host; see server/worker.ts.

import { describe, expect, it } from "vitest";
import { proxyDecisionFor, rewritePath } from "../app/lib/api-proxy";

/** Real paths the browser client actually requests (app/lib/api.ts + avatar URLs). */
const API_PATHS = [
  "/api/health",
  "/api/me",
  "/api/auth/nonce",
  "/api/auth/verify",
  "/api/auth/logout",
  "/api/handle/claim",
  "/api/profile",
  "/api/board/satoshi",
  "/api/questions",
  "/api/questions/received",
  "/api/questions/asked",
  "/api/questions/2f1c9e4a-0000-4000-8000-000000000000",
  "/api/questions/2f1c9e4a-0000-4000-8000-000000000000/answer",
  "/api/questions/2f1c9e4a-0000-4000-8000-000000000000/publish",
  "/api/avatar",
  "/api/p/2f1c9e4a-0000-4000-8000-000000000000",
];

/** App routes that MUST reach React Router — proxying any of these would break the site. */
const APP_PATHS = [
  "/",
  "/app",
  "/dashboard",
  "/onboarding",
  "/settings/profile",
  "/satoshi",
  "/ask/satoshi",
  "/questions/2f1c9e4a-0000-4000-8000-000000000000",
  "/p/2f1c9e4a-0000-4000-8000-000000000000",
  "/robots.txt",
  "/og.png",
  "/__manifest",
];

describe("regression: same-origin API proxy routes /api/* away from the SSR catch-all", () => {
  it("proxies every API path the client actually calls", () => {
    for (const path of API_PATHS) {
      expect(proxyDecisionFor(path).proxy, `${path} must be proxied`).toBe(true);
    }
  });

  it("strips the /api prefix so it hits the API's root-mounted routes", () => {
    expect(rewritePath("/api/health", true)).toBe("/health");
    expect(rewritePath("/api/auth/nonce", true)).toBe("/auth/nonce");
    expect(rewritePath("/api/questions/received", true)).toBe("/questions/received");
  });

  it("never rewrites to an empty path (a bare /api becomes /)", () => {
    const d = proxyDecisionFor("/api");
    expect(d.proxy).toBe(true);
    expect(rewritePath("/api", d.stripPrefix)).toBe("/");
  });

  it("proxies /avatars/* WITHOUT stripping — the API serves them at that literal path", () => {
    const d = proxyDecisionFor("/avatars/0xabc/pic.png");
    expect(d.proxy).toBe(true);
    expect(d.stripPrefix).toBe(false);
    expect(rewritePath("/avatars/0xabc/pic.png", d.stripPrefix)).toBe("/avatars/0xabc/pic.png");
  });

  it("leaves every app route to React Router", () => {
    for (const path of APP_PATHS) {
      expect(proxyDecisionFor(path).proxy, `${path} must NOT be proxied`).toBe(false);
    }
  });

  it("does not capture lookalike prefixes that belong to the app", () => {
    // A creator whose handle starts with "api", or a route merely containing the substring, must
    // still render the app. Only the exact `/api` segment is the API.
    for (const path of ["/apiary", "/api-docs", "/apis/health", "/x/api/health", "/avatarsx/a"]) {
      expect(proxyDecisionFor(path).proxy, `${path} must NOT be proxied`).toBe(false);
    }
  });
});
