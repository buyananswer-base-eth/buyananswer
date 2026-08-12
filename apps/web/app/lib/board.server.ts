// SPDX-License-Identifier: MIT
// Server-only helpers for the public board loader. The board is a PUBLIC read (no cookie), so the SSR
// loader fetches the API Worker directly rather than round-tripping through the same-origin `/api`
// proxy that browser (cookie-bearing) calls use. Kept in a `.server` module so `process.env` and the
// direct API origin never enter the client bundle.

import type { PublicCreator } from "./api";

// Where the SSR loader reaches the API. Dev default matches the Vite proxy target (the API Worker on
// :8787). In production set SSR_API_ORIGIN to the API Worker's origin (or wire a service binding).
const DEFAULT_API_ORIGIN = "http://127.0.0.1:8787";

/** Origin the SSR loader uses to reach the API Worker for public reads. */
export function serverApiOrigin(): string {
  return process.env.SSR_API_ORIGIN?.trim() || DEFAULT_API_ORIGIN;
}

/**
 * The absolute, canonical site origin for OG/canonical URLs. Production pins `buyananswer.com`
 * (ADR-0011) via SITE_ORIGIN; in dev it falls back to the incoming request origin so OG image and
 * canonical URLs resolve locally (e.g. http://localhost:5173).
 */
export function siteOrigin(request: Request): string {
  const env = process.env.SITE_ORIGIN?.trim();
  return (env || new URL(request.url).origin).replace(/\/+$/, "");
}

export type BoardResult = { ok: true; creator: PublicCreator } | { ok: false; status: number };

/** Fetch a public board from the API Worker. `{ ok:false, status:404 }` when the handle is unknown. */
export async function fetchBoard(handle: string): Promise<BoardResult> {
  const url = `${serverApiOrigin()}/board/${encodeURIComponent(handle)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (cause) {
    // Network failure reaching the API → surface as a 503 the route can render as a service-down state.
    throw new Response("api_unreachable", { status: 503, statusText: "API unreachable" });
  }
  if (res.status === 404) return { ok: false, status: 404 };
  if (!res.ok) return { ok: false, status: res.status };
  const data = (await res.json()) as { creator: PublicCreator };
  return { ok: true, creator: data.creator };
}
