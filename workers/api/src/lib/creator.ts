// SPDX-License-Identifier: MIT
// Creator presenters. The DB stores `links` as a JSON string; API responses expose it as a parsed
// array. The public projection (board reads) deliberately omits nothing sensitive today, but is an
// explicit allowlist so a future private column can never leak by default (FUNCTIONAL_SPEC §9).

import type { Creator } from "@buyananswer/shared";
import type { ProfileLink } from "../schemas.js";

function parseLinks(raw: string | null): ProfileLink[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ProfileLink[]) : null;
  } catch {
    return null;
  }
}

/** Owner-facing view (`GET /me`): the full profile the signed-in creator manages. */
export function presentOwnerCreator(creator: Creator) {
  return {
    wallet: creator.wallet,
    handle: creator.handle,
    displayName: creator.displayName,
    headline: creator.headline,
    bio: creator.bio,
    avatarUrl: creator.avatarUrl,
    links: parseLinks(creator.links),
    minPriceUsdc: creator.minPriceUsdc,
    createdAt: creator.createdAt,
    updatedAt: creator.updatedAt,
  };
}

/**
 * Public board view (`GET /board/:handle`): an explicit allowlist of public fields. `wallet` is
 * public on purpose — it is the on-chain answerer address a payer needs to build the ask tx. No
 * internal timestamps (`updatedAt`) are exposed.
 */
export function presentPublicCreator(creator: Creator) {
  return {
    wallet: creator.wallet,
    handle: creator.handle,
    displayName: creator.displayName,
    headline: creator.headline,
    bio: creator.bio,
    avatarUrl: creator.avatarUrl,
    links: parseLinks(creator.links),
    minPriceUsdc: creator.minPriceUsdc,
    createdAt: creator.createdAt,
  };
}
