// SPDX-License-Identifier: MIT
// Route table (React Router v7 config routing).
//
// Two trees under the root document:
//   1. `app-layout` — the INTERACTIVE app (wallet + auth). Owns the client-only Web3 boundary, so
//      wallet libs load only here. Children: home (connect→SIWE), dashboard, onboarding, profile editor.
//   2. Public routes — server-rendered WITHOUT wallet libs: the `/:handle` creator board + its OG image.
//
// Route precedence (watch-out from the session brief): literal paths always beat the dynamic `:handle`
// segment, so `/dashboard`, `/onboarding`, `/settings/profile` (and future `/p/:id`) win over a board
// named e.g. "dashboard". Reserved handles can never be claimed (mirrored client + server), so they
// 404 at the board. `/api/*` never reaches the router (dev: Vite proxy; prod: Pages proxy).

import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  // Public marketing landing (SSR, no wallet libs). The only entry into the app is its "Enter App"
  // button → `/app` (`app.buyananswer.com` in production). Sibling of the wallet boundary, like the board.
  index("routes/landing.tsx"),

  // Farcaster Mini App manifest (ADR-0042). A loader-only resource route, so it is explicit and
  // testable rather than depending on a dot-directory surviving the asset pipeline. Declared before
  // the dynamic `:handle` board — a literal path wins, but keeping it adjacent to `/` makes the
  // precedence obvious to a reader.
  route(".well-known/farcaster.json", "routes/farcaster-manifest.ts"),

  layout("routes/app-layout.tsx", [
    // The app entry: connect → SIWE → session. Lives at `/app` so `/` can be the landing. `app` is a
    // reserved handle on both sides, so `/app` never collides with the one-segment `:handle` board.
    route("app", "routes/home.tsx"),
    route("dashboard", "routes/dashboard.tsx"),
    route("onboarding", "routes/onboarding.tsx"),
    route("settings/profile", "routes/settings.profile.tsx"),
    // Ask + pay a creator (needs the wallet boundary). The `ask` prefix is a reserved handle on both
    // sides, so a two-segment `/ask/:handle` never collides with the one-segment `:handle` board.
    route("ask/:handle", "routes/ask.tsx"),
    // Question detail + settle actions (inbox → answer/decline, history → cancel/reclaim). Two segments,
    // so `/questions/:id` never collides with the one-segment `:handle` board.
    route("questions/:id", "routes/question.tsx"),
  ]),

  // Public creator board (SSR, no wallet libs). OG tags are per-handle; the OG *image* is a static
  // branded card (public/og.png) — dynamic per-handle image rendering is deferred to the Workers
  // runtime where a wasm rasterizer runs (ADR-0026).
  route(":handle", "routes/board.tsx"),
] satisfies RouteConfig;
