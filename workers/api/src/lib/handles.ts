// SPDX-License-Identifier: MIT
// Handle rules (FUNCTIONAL_SPEC §3.1): case-insensitive, `^[a-z0-9_]{3,30}$`, reserved names blocked.
// Handles are always normalized to lowercase before validation or lookup, so a plain unique index
// gives case-insensitive uniqueness (the schema also enforces the format via CHECK).

/** Canonical handle regex (post-normalization). */
export const HANDLE_REGEX = /^[a-z0-9_]{3,30}$/;

/**
 * Reserved handles that must never be claimed — routes, brand words, and namespaces that would
 * collide with app paths or impersonate the platform. Compared against the lowercased handle.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "admin",
  "administrator",
  "api",
  "app",
  "about",
  "ask",
  "auth",
  "avatar",
  "avatars",
  "board",
  "dashboard",
  "explore",
  "frame",
  "frames",
  "health",
  "help",
  "home",
  "index",
  "legal",
  "login",
  "logout",
  "me",
  "new",
  "onboard",
  "onboarding",
  "p",
  "privacy",
  "profile",
  "public",
  "question",
  "questions",
  "reclaim",
  "root",
  "settings",
  "signin",
  "signout",
  "signup",
  "static",
  "support",
  "terms",
  "user",
  "users",
  "www",
  "_next",
]);

/** Lowercase + trim a raw handle for validation and lookup. */
export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

/** True when a (already-normalized) handle is on the reserved blocklist. */
export function isReservedHandle(handle: string): boolean {
  return RESERVED_HANDLES.has(handle);
}
