// SPDX-License-Identifier: MIT
import { Button } from "../ui/Button";
import styles from "./states.module.css";

export interface ErrorStateProps {
  title?: string | undefined;
  message?: string | undefined;
  onRetry?: (() => void) | undefined;
  retryLabel?: string | undefined;
}

/** The canonical "error" async state, with an optional retry affordance. */
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Try again",
}: ErrorStateProps) {
  return (
    <div className={styles.state} role="alert">
      <div className={`${styles.icon} ${styles.iconDanger}`} aria-hidden="true">
        !
      </div>
      <div className={styles.text}>
        <h2 className={styles.title}>{title}</h2>
        {message ? <p className="muted">{message}</p> : null}
      </div>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
