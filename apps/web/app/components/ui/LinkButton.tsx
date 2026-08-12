// SPDX-License-Identifier: MIT
// A React Router <Link> styled as a button — reuses Button's CSS module so links and buttons match.

import { Link, type LinkProps } from "react-router";
import { cx } from "../../lib/cx";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface LinkButtonProps extends LinkProps {
  variant?: Variant;
  size?: Size;
}

export function LinkButton({
  variant = "primary",
  size = "md",
  className,
  ...rest
}: LinkButtonProps) {
  return <Link className={cx(styles.button, styles[variant], styles[size], className)} {...rest} />;
}
