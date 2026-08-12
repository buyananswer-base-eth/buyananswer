// SPDX-License-Identifier: MIT
// Render a Farcaster frame as an HTML document with the `fc:frame` meta tags (the current "vNext" frame
// spec) plus Open Graph fallbacks. This is a tiny purpose-built renderer rather than a framework: the
// stack is Cloudflare Workers + Node 20 + wrangler 3, where the raw spec is dependency-light and fully
// testable, and ADR-0013 explicitly sanctions "frames.js (or the raw frame spec)" (see ADR-0031).
//
// Button actions: `tx` (transaction frame — needs `target` = tx endpoint + `postUrl` = post-tx
// callback), `link` (open a URL), `post` (POST to `target`/frame post_url). At most 4 buttons.

import { FRAME_IMAGE_ASPECT } from "./images.js";

export interface FrameButton {
  label: string;
  action: "tx" | "post" | "link";
  /** tx: the transaction data endpoint; link: the URL to open; post: the POST target. */
  target?: string;
  /** tx buttons only: where the client POSTs after the wallet submits the transaction. */
  postUrl?: string;
}

export interface FrameSpec {
  /** `<title>` + `og:title`. */
  title: string;
  /** Absolute image URL (1.91:1). */
  image: string;
  /** If set, renders a single text input with this placeholder. */
  input?: string;
  /** Frame-level `fc:frame:post_url` (fallback for `post` buttons). */
  postUrl?: string;
  /** `fc:frame:state`, echoed by the client on the next action. */
  state?: string;
  /** 1–4 buttons, in order. */
  buttons: FrameButton[];
}

/** Escape a string for safe interpolation into an HTML attribute value. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const meta = (property: string, content: string) =>
  `    <meta property="${escapeAttr(property)}" content="${escapeAttr(content)}"/>`;

/** Render a frame to a full HTML document string. */
export function renderFrame(spec: FrameSpec): string {
  const lines: string[] = [
    meta("og:title", spec.title),
    meta("og:image", spec.image),
    meta("fc:frame", "vNext"),
    meta("fc:frame:image", spec.image),
    meta("fc:frame:image:aspect_ratio", FRAME_IMAGE_ASPECT),
  ];

  if (spec.input) lines.push(meta("fc:frame:input:text", spec.input));
  if (spec.postUrl) lines.push(meta("fc:frame:post_url", spec.postUrl));
  if (spec.state) lines.push(meta("fc:frame:state", spec.state));

  spec.buttons.slice(0, 4).forEach((button, i) => {
    const n = i + 1;
    lines.push(meta(`fc:frame:button:${n}`, button.label));
    lines.push(meta(`fc:frame:button:${n}:action`, button.action));
    if (button.target) lines.push(meta(`fc:frame:button:${n}:target`, button.target));
    if (button.action === "tx" && button.postUrl) {
      lines.push(meta(`fc:frame:button:${n}:post_url`, button.postUrl));
    }
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>${escapeAttr(spec.title)}</title>
${lines.join("\n")}
  </head>
  <body>
    <p>${escapeAttr(spec.title)}</p>
  </body>
</html>`;
}

/** A frame HTML `Response` (200, `text/html`). */
export function frameResponse(spec: FrameSpec): Response {
  return new Response(renderFrame(spec), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
