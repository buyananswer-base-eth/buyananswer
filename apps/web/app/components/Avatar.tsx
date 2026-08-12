// SPDX-License-Identifier: MIT
// Avatar: the creator image, or a neutral initials fallback when none is set. Used by the public
// board, the profile editor preview, and the dashboard.

import { cx } from "../lib/cx";
import styles from "./Avatar.module.css";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + second).toUpperCase();
}

export interface AvatarProps {
  src?: string | null;
  name: string;
  /** Diameter in px. */
  size?: number;
  className?: string;
}

export function Avatar({ src, name, size = 96, className }: AvatarProps) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className={cx(styles.avatar, styles.image, className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={cx(styles.avatar, styles.fallback, className)}
      style={style}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
