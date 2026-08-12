// SPDX-License-Identifier: MIT
import type { ReactNode } from "react";
import { cx } from "../../lib/cx";
import styles from "./Badge.module.css";

type Tone = "neutral" | "accent" | "success" | "danger" | "warning";

export interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
}

/** A small status pill. */
export function Badge({ tone = "neutral", children }: BadgeProps) {
  return <span className={cx(styles.badge, styles[tone])}>{children}</span>;
}
