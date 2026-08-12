// SPDX-License-Identifier: MIT
// Farcaster **Mini App** support (ADR-0042) — replaces the deleted v1 frame Worker.
//
// A Mini App is not a new frame format: it is THIS web app, loaded in a webview inside a Farcaster
// client, with an EIP-1193 wallet provider injected. So the entire ask+pay money path (ADR-0027)
// is reused verbatim — there is no second payment surface to keep in sync, which is exactly why
// workers/frame was deleted rather than ported.
//
// Two things make the app discoverable as a Mini App, and both are plain metadata:
//   1. a **manifest** at `/.well-known/farcaster.json` (served by routes/farcaster-manifest.ts)
//   2. an **embed tag** — `fc:miniapp` — on any page worth sharing into a cast
//
// Everything here is pure so it can be unit-tested; nothing touches the SDK (see useMiniApp.ts).

/** The Mini App's canonical display name. Spec caps this at 32 characters. */
export const MINIAPP_NAME = "BuyAnAnswer";

/** Splash background — matches the brand's warm-ink light background (tokens.css). */
export const SPLASH_BACKGROUND_COLOR = "#faf8f1";

/**
 * Embed image. The spec wants **3:2**; `og.png` is 1200×630 (1.91:1) for Open Graph and would be
 * letterboxed or cropped, so a dedicated 1200×800 asset is generated from the same source art.
 */
export const EMBED_IMAGE_PATH = "/miniapp/embed.png";
/** 1024×1024 PNG, required by the manifest. */
export const ICON_PATH = "/miniapp/icon.png";
/** 200×200 PNG shown while the Mini App boots. */
export const SPLASH_IMAGE_PATH = "/miniapp/splash.png";

/** A Mini App embed button action (spec: `launch_frame`, kept for client compatibility). */
export interface MiniAppAction {
  readonly type: "launch_frame";
  readonly name: string;
  readonly url: string;
  readonly splashImageUrl: string;
  readonly splashBackgroundColor: string;
}

/** The `fc:miniapp` embed payload. Serialized into a meta tag's `content`. */
export interface MiniAppEmbed {
  readonly version: "1";
  readonly imageUrl: string;
  readonly button: {
    readonly title: string;
    readonly action: MiniAppAction;
  };
}

/** Join an origin and an absolute path without doubling or dropping the slash. */
function absolute(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}${path}`;
}

/**
 * Build the `fc:miniapp` embed payload for a shareable page.
 *
 * `launchUrl` is where the Farcaster client opens the app — for a creator board that is the ask
 * page, so a tap goes straight to paying rather than to a landing page the user must navigate.
 * Every URL must be ABSOLUTE: the embed is read by a remote client that has no page context.
 */
export function buildMiniAppEmbed(params: {
  origin: string;
  launchPath: string;
  buttonTitle: string;
  imagePath?: string;
}): MiniAppEmbed {
  return {
    version: "1",
    imageUrl: absolute(params.origin, params.imagePath ?? EMBED_IMAGE_PATH),
    button: {
      // Farcaster truncates long button labels; keep these short and verb-first.
      title: params.buttonTitle,
      action: {
        type: "launch_frame",
        name: MINIAPP_NAME,
        url: absolute(params.origin, params.launchPath),
        splashImageUrl: absolute(params.origin, SPLASH_IMAGE_PATH),
        splashBackgroundColor: SPLASH_BACKGROUND_COLOR,
      },
    },
  };
}

/**
 * Render the embed as React Router `meta` descriptors.
 *
 * Emits BOTH `fc:miniapp` and `fc:frame`. They carry the identical payload: `fc:frame` is the
 * backward-compatibility alias the spec still honours, so older clients resolve the same Mini App
 * rather than falling back to a dead v1 frame. This is NOT the old `fc:frame: vNext` tag.
 */
export function miniAppMetaTags(embed: MiniAppEmbed): Array<{ name: string; content: string }> {
  const content = JSON.stringify(embed);
  return [
    { name: "fc:miniapp", content },
    { name: "fc:frame", content },
  ];
}

/** A JSON Farcaster Signature triple proving an FID controls the domain. */
export interface AccountAssociation {
  readonly header: string;
  readonly payload: string;
  readonly signature: string;
}

/**
 * Build the `/.well-known/farcaster.json` manifest.
 *
 * `accountAssociation` is a signature the OWNER must generate (Farcaster developer tools → sign for
 * this domain). It cannot be produced from code — it proves a specific FID controls the domain.
 * Until it is real, the manifest still serves and the app still runs when opened directly; it is
 * only *discovery* and attribution that need it.
 */
export function buildManifest(params: {
  origin: string;
  accountAssociation: AccountAssociation;
}): Record<string, unknown> {
  return {
    accountAssociation: params.accountAssociation,
    miniapp: {
      version: "1",
      name: MINIAPP_NAME,
      homeUrl: absolute(params.origin, "/"),
      iconUrl: absolute(params.origin, ICON_PATH),
      splashImageUrl: absolute(params.origin, SPLASH_IMAGE_PATH),
      splashBackgroundColor: SPLASH_BACKGROUND_COLOR,
      subtitle: "Get paid for your answers",
      description:
        "Your link in bio, but every tip buys a real answer. Questions are paid in USDC on Base and held onchain — you only pay for answers, and you're refunded if they don't.",
      primaryCategory: "social",
      tags: ["qa", "creators", "usdc", "base", "payments"],
    },
  };
}
