// SPDX-License-Identifier: MIT
import styles from "./Spinner.module.css";

export interface SpinnerProps {
  /** Diameter in px. */
  size?: number;
  /** Accessible label (announced to screen readers). */
  label?: string;
}

/** An indeterminate loading spinner. Respects reduced-motion via the global stylesheet. */
export function Spinner({ size = 20, label = "Loading" }: SpinnerProps) {
  return (
    <span
      className={styles.spinner}
      style={{ width: size, height: size }}
      role="status"
      aria-label={label}
    />
  );
}
