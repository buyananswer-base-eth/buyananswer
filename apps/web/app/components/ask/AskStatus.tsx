// SPDX-License-Identifier: MIT
// Renders the live/terminal status of the ask + pay flow — every money state the session brief requires:
// creating, checking, needs-permit/approval, tx pending, waiting-for-indexer (with a "taking longer"
// hint + manual re-check), tx rejected, and server/on-chain errors. The `confirmed` and `idle` states
// are handled by the composer (a success card / the editable form), so this returns null for them.

import type { AskPhase } from "../../hooks/useAskAndPay";
import { cx } from "../../lib/cx";
import { formatUsdc } from "../../lib/usdc";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import styles from "./ask.module.css";

interface Props {
  phase: AskPhase;
  explorerBase: string | null;
  onRetry: () => void;
  onRecheck: () => void;
  onReset: () => void;
}

function txUrl(explorerBase: string | null, hash: string): string | null {
  return explorerBase ? `${explorerBase}/tx/${hash}` : null;
}

/** A neutral "working" row with a spinner and a message + optional hint. */
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

export function AskStatus({ phase, explorerBase, onRetry, onRecheck, onReset }: Props) {
  switch (phase.step) {
    case "idle":
    case "confirmed":
      return null;

    case "creating":
      return <Working message="Creating your question…" />;
    case "checking":
      return <Working message="Checking your USDC balance…" />;
    case "permitting":
      return (
        <Working
          message="Approve the USDC permit in your wallet"
          hint="One signature approves the USDC for this payment — no separate approval step."
        />
      );
    case "approving":
      return (
        <Working
          message="Approving USDC…"
          hint="Your wallet doesn't support single-signature permits, so we're using a standard approval."
        />
      );
    case "confirming":
      return <Working message="Confirm the payment in your wallet…" />;

    case "pending": {
      const url = txUrl(explorerBase, phase.hash);
      return (
        <div className={styles.status} aria-live="polite">
          <Spinner size={18} label="Waiting for the transaction" />
          <div className={styles.statusText}>
            <span>Payment sent — waiting for the transaction to confirm…</span>
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
        <div className={cx(styles.status)} aria-live="polite">
          <Spinner size={18} label="Confirming payment" />
          <div className={styles.statusText}>
            <span>Payment confirmed on-chain — finalizing your question…</span>
            <span className={styles.statusHint}>
              {phase.slow
                ? "This is taking longer than usual — we double-check the chain about every 2 minutes. Your money is safe."
                : "Confirming your payment on-chain…"}
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

    case "insufficient":
      return (
        <div className={cx(styles.status, styles["tone-danger"])} role="alert">
          <div className={styles.statusText}>
            <strong>Not enough USDC</strong>
            <span>
              You need <strong>{formatUsdc(phase.needed.toString())} USDC</strong> but have{" "}
              {formatUsdc(phase.balance.toString())} USDC. Add USDC to this wallet, then try again.
            </span>
            <div className={styles.actions}>
              <Button size="sm" onClick={onRetry}>
                Try again
              </Button>
              <Button size="sm" variant="ghost" onClick={onReset}>
                Edit question
              </Button>
            </div>
          </div>
        </div>
      );

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
                Edit question
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
                Edit question
              </Button>
            </div>
          </div>
        </div>
      );

    default: {
      // Exhaustiveness guard — a new phase must add a branch above.
      const _never: never = phase;
      return _never;
    }
  }
}
