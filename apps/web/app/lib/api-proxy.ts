// SPDX-License-Identifier: MIT
// Routing decision for the same-origin API proxy (ADR-0038). Pure and dependency-free so it can be
// unit-tested — `server/worker.ts` imports the generated server build, which only exists after a
// build, so the decision lives here rather than inline in the Worker.
//
// WHY THIS EXISTS: the client calls the API same-origin under `/api/*` (app/lib/api.ts) with
// `credentials: "include"`. Same-origin is what makes the API's SameSite=Lax `ba_session` cookie
// usable at all (ADR-0022) — calling api.buyananswer.com directly would be cross-site, and a Lax
// cookie is not sent cross-site, so sessions would silently never persist. In dev, Vite's proxy
// does this. Production shipped without an equivalent and every `/api/*` request fell through to
// React Router's SSR catch-all and returned a 404 HTML page, which the UI surfaced as
// "Can't reach the server".

/** What the Worker should do with a request path. */
export interface ProxyDecision {
  /** Forward to the API service binding instead of the React Router handler. */
  readonly proxy: boolean;
  /** Strip the leading `/api` before forwarding (the API mounts its routes at the root). */
  readonly stripPrefix: boolean;
}

const PASS_THROUGH: ProxyDecision = { proxy: false, stripPrefix: false };

/**
 * Decide whether `pathname` belongs to the API rather than the app router.
 *
 * `/api/*` is stripped — the API serves `/health`, `/auth/nonce`, … at the root, mirroring Vite's
 * dev `rewrite`. `/avatars/*` is NOT stripped: the API serves R2 objects at that exact path when
 * `AVATAR_PUBLIC_BASE_URL` is unset, and stored `avatar_url` values already embed it.
 */
export function proxyDecisionFor(pathname: string): ProxyDecision {
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return { proxy: true, stripPrefix: true };
  }
  if (pathname.startsWith("/avatars/")) {
    return { proxy: true, stripPrefix: false };
  }
  return PASS_THROUGH;
}

/** Apply {@link ProxyDecision.stripPrefix} to a pathname, never yielding an empty path. */
export function rewritePath(pathname: string, stripPrefix: boolean): string {
  if (!stripPrefix) return pathname;
  return pathname.replace(/^\/api/, "") || "/";
}
