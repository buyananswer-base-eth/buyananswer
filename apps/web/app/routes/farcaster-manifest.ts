// SPDX-License-Identifier: MIT
// Resource route serving `/.well-known/farcaster.json` — the Farcaster Mini App manifest (ADR-0042).
//
// Served from a route rather than `public/` on purpose: a dot-directory's survival through the Vite
// public copy and Workers Static Assets matching is an implementation detail to rely on, whereas a
// route is explicit and unit-testable. Loader-only (no default export), so nothing renders.
//
// The `accountAssociation` comes from env, never source: it is a signature tied to a specific FID
// and domain, and this repo is public. Unset ⇒ the manifest still serves with empty strings, which
// is honest — the app runs fine when opened directly; only discovery/attribution needs the proof.

import { siteOrigin } from "../lib/board.server";
import { buildManifest } from "../lib/miniapp";
import type { Route } from "./+types/farcaster-manifest";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = (context as { cloudflare?: { env?: Record<string, string | undefined> } })?.cloudflare
    ?.env;

  const manifest = buildManifest({
    origin: siteOrigin(request),
    accountAssociation: {
      header: env?.FARCASTER_HEADER ?? process.env.FARCASTER_HEADER ?? "",
      payload: env?.FARCASTER_PAYLOAD ?? process.env.FARCASTER_PAYLOAD ?? "",
      signature: env?.FARCASTER_SIGNATURE ?? process.env.FARCASTER_SIGNATURE ?? "",
    },
  });

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Farcaster clients re-fetch this; a short cache keeps edits from taking hours to appear.
      "cache-control": "public, max-age=300",
    },
  });
}
