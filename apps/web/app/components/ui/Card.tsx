// SPDX-License-Identifier: MIT
import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../../lib/cx";
import styles from "./Card.module.css";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Removes the default inner padding (for edge-to-edge content). */
  flush?: boolean | undefined;
}

/** A surface container: bordered, rounded, subtle shadow. */
export function Card({ flush, className, children, ...rest }: CardProps) {
  return (
    <section className={cx(styles.card, flush && styles.flush, className)} {...rest}>
      {children}
    </section>
  );
}
