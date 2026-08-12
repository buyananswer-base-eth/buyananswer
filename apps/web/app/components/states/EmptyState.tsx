// SPDX-License-Identifier: MIT
import type { ReactNode } from "react";
import styles from "./states.module.css";

export interface EmptyStateProps {
  title: string;
  message?: string | undefined;
  icon?: ReactNode;
  action?: ReactNode;
}

/** The canonical "empty" async state (no data yet), with an optional call-to-action. */
export function EmptyState({ title, message, icon, action }: EmptyStateProps) {
  return (
    <div className={styles.state}>
      {icon ? (
        <div className={styles.icon} aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <div className={styles.text}>
        <h2 className={styles.title}>{title}</h2>
        {message ? <p className="muted">{message}</p> : null}
      </div>
      {action}
    </div>
  );
}
