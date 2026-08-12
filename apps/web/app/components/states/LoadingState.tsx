// SPDX-License-Identifier: MIT
import { Spinner } from "../ui/Spinner";
import styles from "./states.module.css";

export interface LoadingStateProps {
  message?: string | undefined;
}

/** The canonical "loading" async state. */
export function LoadingState({ message = "Loading…" }: LoadingStateProps) {
  return (
    <output className={styles.state} aria-live="polite">
      <Spinner size={28} label={message} />
      <p className={styles.message}>{message}</p>
    </output>
  );
}
