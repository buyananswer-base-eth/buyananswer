// SPDX-License-Identifier: MIT
// Client-side handle rules — a DELIBERATE MIRROR of the server (workers/api/src/lib/handles.ts +
// schemas.ts `handleSchema`) so the claim form can give instant feedback with the exact same rule the
// API enforces. The server is ALWAYS authoritative: it re-validates, blocks reserved names, and owns
// uniqueness (a clean 409). Keep RESERVED_HANDLES and HANDLE_REGEX in sync with the API on any change.

/** Canonical handle regex (post-normalization) — matches the API's `^[a-z0-9_]{3,30}$`. */
export const HANDLE_REGEX = /^[a-z0-9_]{3,30}$/;

/** Min/max handle length (for granular messages before the regex check). */
export const HANDLE_MIN = 3;
export const HANDLE_MAX = 30;

/**
 * Reserved handles the server will reject (409 `handle_reserved`). Mirrors
 * workers/api/src/lib/handles.ts `RESERVED_HANDLES`. These are app routes, brand words, and
 * namespaces that would collide with real paths or impersonate the platform.
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

/** Lowercase + trim a raw handle for validation and lookup (matches the API's `normalizeHandle`). */
export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

/** True when a (already-normalized) handle is on the reserved blocklist. */
export function isReservedHandle(handle: string): boolean {
  return RESERVED_HANDLES.has(handle);
}

export type HandleValidation = { ok: true; handle: string } | { ok: false; reason: string };

/**
 * Validate a raw handle input the same way the server will, returning either the normalized handle or
 * a human-friendly reason. Ordering mirrors the messages a user most needs: length → charset →
 * reserved. The server remains the source of truth (uniqueness + a re-check).
 */
export function validateHandle(raw: string): HandleValidation {
  const handle = normalizeHandle(raw);
  if (handle.length === 0) return { ok: false, reason: "Pick a handle for your link." };
  if (handle.length < HANDLE_MIN) {
    return { ok: false, reason: `At least ${HANDLE_MIN} characters.` };
  }
  if (handle.length > HANDLE_MAX) {
    return { ok: false, reason: `At most ${HANDLE_MAX} characters.` };
  }
  if (!HANDLE_REGEX.test(handle)) {
    return { ok: false, reason: "Use only lowercase letters, numbers, and underscores." };
  }
  if (isReservedHandle(handle)) {
    return { ok: false, reason: "That handle is reserved — try another." };
  }
  return { ok: true, handle };
}
