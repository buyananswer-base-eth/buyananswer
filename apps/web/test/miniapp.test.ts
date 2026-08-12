// SPDX-License-Identifier: MIT
// Farcaster Mini App metadata (ADR-0042) — the replacement for the deleted v1 frame Worker.
//
// This metadata is read by a REMOTE client that has no page context, so the failure mode is silent:
// a relative URL, a wrong ratio, or a stale `vNext` tag doesn't throw anywhere — the cast just
// renders as a plain link and nobody can pay. That is exactly what happened to the v1 frame, and
// it went unnoticed because nothing in the app depends on this being right.
//
// So these tests pin the properties a human cannot eyeball in a JSON blob.

import { describe, expect, it } from "vitest";
import {
  EMBED_IMAGE_PATH,
  MINIAPP_NAME,
  buildManifest,
  buildMiniAppEmbed,
  miniAppMetaTags,
} from "../app/lib/miniapp";

const ORIGIN = "https://buyananswer.com";

describe("Mini App embed", () => {
  const embed = buildMiniAppEmbed({
    origin: ORIGIN,
    launchPath: "/ask/satoshi",
    buttonTitle: "Ask Satoshi",
  });

  it("declares version 1 and the launch action", () => {
    expect(embed.version).toBe("1");
    expect(embed.button.action.type).toBe("launch_frame");
    expect(embed.button.action.name).toBe(MINIAPP_NAME);
  });

  it("makes EVERY url absolute — a remote client cannot resolve a relative path", () => {
    const urls = [embed.imageUrl, embed.button.action.url, embed.button.action.splashImageUrl];
    for (const url of urls) {
      expect(url, `${url} must be absolute`).toMatch(/^https:\/\//);
    }
  });

  it("launches straight into paying, not the board or a landing page", () => {
    // A cast of a creator's board should open the ask flow — an extra hop loses people.
    expect(embed.button.action.url).toBe(`${ORIGIN}/ask/satoshi`);
  });

  it("uses the dedicated 3:2 embed image, NOT the 1.91:1 Open Graph one", () => {
    // og.png is 1200x630 for OG/Twitter; Farcaster wants 3:2 and would crop it.
    expect(embed.imageUrl).toBe(`${ORIGIN}${EMBED_IMAGE_PATH}`);
    expect(embed.imageUrl).not.toContain("og.png");
  });

  it("never doubles or drops the slash when joining origin and path", () => {
    const trailing = buildMiniAppEmbed({
      origin: "https://buyananswer.com/",
      launchPath: "/app",
      buttonTitle: "Open",
    });
    expect(trailing.button.action.url).toBe("https://buyananswer.com/app");
  });
});

describe("Mini App meta tags", () => {
  const tags = miniAppMetaTags(
    buildMiniAppEmbed({ origin: ORIGIN, launchPath: "/app", buttonTitle: "Open" }),
  );

  it("emits fc:miniapp AND fc:frame with an identical payload", () => {
    const byName = Object.fromEntries(tags.map((t) => [t.name, t.content]));
    expect(Object.keys(byName).sort()).toEqual(["fc:frame", "fc:miniapp"]);
    // fc:frame is the backward-compatibility ALIAS carrying the Mini App payload — older clients
    // must resolve the Mini App, not fall back to a v1 frame.
    expect(byName["fc:frame"]).toBe(byName["fc:miniapp"]);
  });

  it("is NOT the deprecated v1 frame tag", () => {
    // The old surface emitted `fc:frame` = "vNext". Shipping that again would silently regress to a
    // deprecated spec that no longer executes transactions.
    for (const tag of tags) {
      expect(tag.content).not.toBe("vNext");
      expect(tag.content).toContain('"version":"1"');
    }
  });

  it("serializes to valid JSON a client can parse", () => {
    for (const tag of tags) {
      expect(() => JSON.parse(tag.content)).not.toThrow();
    }
  });
});

describe("Mini App manifest", () => {
  const manifest = buildManifest({
    origin: ORIGIN,
    accountAssociation: { header: "h", payload: "p", signature: "s" },
  }) as {
    accountAssociation: Record<string, string>;
    miniapp: Record<string, unknown>;
  };

  it("carries the account association and the required miniapp fields", () => {
    expect(manifest.accountAssociation).toEqual({ header: "h", payload: "p", signature: "s" });
    for (const field of ["version", "name", "homeUrl", "iconUrl"]) {
      expect(manifest.miniapp[field], `${field} is required by the spec`).toBeTruthy();
    }
  });

  it("keeps the name within the 32-character cap", () => {
    expect((manifest.miniapp.name as string).length).toBeLessThanOrEqual(32);
  });

  it("uses absolute urls throughout", () => {
    for (const key of ["homeUrl", "iconUrl", "splashImageUrl"]) {
      expect(manifest.miniapp[key]).toMatch(/^https:\/\//);
    }
  });

  it("still builds when the association is unset, so the manifest always serves", () => {
    const empty = buildManifest({
      origin: ORIGIN,
      accountAssociation: { header: "", payload: "", signature: "" },
    }) as { miniapp: Record<string, unknown> };
    expect(empty.miniapp.version).toBe("1");
  });
});
