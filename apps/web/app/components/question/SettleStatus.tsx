// SPDX-License-Identifier: MIT
// Renders the live/terminal status of a settle action (answer/decline/cancel/reclaim) — every money
// state §10 requires: preparing (saving the answer draft), confirm-in-wallet, tx pending, waiting-for-
// indexer (with a "taking longer" hint + manual re-check), tx rejected, and preflight/on-chain errors.
// `idle` and `confirmed` are owned by the parent (the editable panel / a success summary) → null here.

import type { SettlePhase } from "../../hooks/useSettleAction";
import { cx } from "../../lib/cx";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import styles from "./question.module.css";

interface Props {
  phase: SettlePhase;
  explorerBase: string | null;
  /** Verb for the pending/indexing copy, e.g. "answer", "decline", "cancel", "reclaim". */
  actionLabel: string;
  onRetry: () => void;
  onRecheck: () => void;
  onReset: () => void;
}

function txUrl(explorerBase: string | null, hash: string): string | null {
  return explorerBase ? `${explorerBase}/tx/${hash}` : null;
}

function Working({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className={styles.status} aria-live="polite">
      <Spinner size={18} label={message} />
      <div className={styles.statusText}>
        <span>{message}</span>
        {hint ? <span className={styles.statusHint}>{hint}</span> : null}
      </div>
    </div>
  );
}

export function SettleStatus({
  phase,
  explorerBase,
  actionLabel,
  onRetry,
  onRecheck,
  onReset,
}: Props) {
  switch (phase.step) {
    case "idle":
    case "confirmed":
      return null;

    case "preparing":
      return <Working message="Saving your answer…" />;
    case "confirming":
      return <Working message="Confirm the transaction in your wallet…" />;

    case "pending": {
      const url = txUrl(explorerBase, phase.hash);
      return (
        <div className={styles.status} aria-live="polite">
          <Spinner size={18} label="Waiting for the transaction" />
          <div className={styles.statusText}>
            <span>Transaction sent — waiting for it to confirm…</span>
            {url ? (
              <a className={styles.txLink} href={url} target="_blank" rel="noreferrer">
                View transaction ↗
              </a>
            ) : null}
          </div>
        </div>
      );
    }

    case "indexing": {
      const url = txUrl(explorerBase, phase.hash);
      return (
        <div className={styles.status} aria-live="polite">
          <Spinner size={18} label="Finalizing" />
          <div className={styles.statusText}>
            <span>Confirmed on-chain — finalizing the {actionLabel}…</span>
            <span className={styles.statusHint}>
              {phase.slow
                ? "This is taking longer than usual — we double-check the chain about every 2 minutes. It's already settled on-chain and safe."
                : "Confirming it on-chain…"}
            </span>
            <div className={styles.actions}>
              <Button size="sm" variant="secondary" onClick={onRecheck}>
                Check now
              </Button>
              {url ? (
                <a className={styles.txLink} href={url} target="_blank" rel="noreferrer">
                  View transaction ↗
                </a>
              ) : null}
            </div>
          </div>
        </div>
      );
    }

    case "rejected":
      return (
        <div className={cx(styles.status, styles["tone-warning"])} role="alert">
          <div className={styles.statusText}>
            <strong>Request cancelled</strong>
            <span>{phase.message}</span>
            <div className={styles.actions}>
              <Button size="sm" onClick={onRetry}>
                Try again
              </Button>
              <Button size="sm" variant="ghost" onClick={onReset}>
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      );

    case "error":
      return (
        <div className={cx(styles.status, styles["tone-danger"])} role="alert">
          <div className={styles.statusText}>
            <strong>Something went wrong</strong>
            <span>{phase.message}</span>
            <div className={styles.actions}>
              <Button size="sm" onClick={onRetry}>
                Try again
              </Button>
              <Button size="sm" variant="ghost" onClick={onReset}>
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      );

    default: {
      const _never: never = phase;
      return _never;
    }
  }
}
