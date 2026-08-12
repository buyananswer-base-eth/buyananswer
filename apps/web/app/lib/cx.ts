// SPDX-License-Identifier: MIT
// Tiny className joiner — drops falsy parts, joins with a space. Avoids a classnames dependency.

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
