// SPDX-License-Identifier: MIT
// Frame image URLs. Today these are STATIC branded PNGs (forked from the brand `og.svg`) served from
// the web app's public dir — a request-time per-creator image needs a Workers-runtime wasm rasterizer,
// the same blocker recorded in ADR-0026 (deferred; ADR-0031 records the choice for the frame). This
// module is the single seam to swap in a dynamic renderer later: change `frameImageUrl` to point at an
// image route and nothing else moves. Aspect ratio is 1.91:1 (1200×630), what Farcaster prefers.

import type { FrameConfig } from "../env.js";

/** The branded frame images, one per step of the ask flow. */
export type FrameImageKind = "ask" | "confirm" | "sent" | "notfound";

/** Aspect ratio Farcaster renders the frame image at (matches the 1200×630 brand cards). */
export const FRAME_IMAGE_ASPECT = "1.91:1";

/** Absolute URL for a branded frame image (static for now; per-creator dynamic later — ADR-0031). */
export function frameImageUrl(config: FrameConfig, kind: FrameImageKind): string {
  return `${config.imageBase}/frame/${kind}.png`;
}
