// SPDX-License-Identifier: MIT
// Avatar image rules (FUNCTIONAL_SPEC §3.1): png/jpeg/webp only, ≤ 5 MB. We do not trust the
// declared Content-Type — the bytes are sniffed by magic number and must agree with the header.

/** Accepted content types → file extension. */
export const AVATAR_CONTENT_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

export type AvatarContentType = keyof typeof AVATAR_CONTENT_TYPES;

/** Max avatar size in bytes (5 MB). */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/** True when `value` is one of the accepted avatar content types. */
export function isAvatarContentType(value: string): value is AvatarContentType {
  return value in AVATAR_CONTENT_TYPES;
}

/**
 * Detect the real image type from the leading bytes (magic numbers), independent of any header:
 *   PNG  → 89 50 4E 47 0D 0A 1A 0A
 *   JPEG → FF D8 FF
 *   WEBP → "RIFF" …… "WEBP"
 * Returns the matching content type, or null if the bytes are not a supported image.
 */
export function sniffImageType(bytes: Uint8Array): AvatarContentType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return "image/webp";
  }
  return null;
}
