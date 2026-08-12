// SPDX-License-Identifier: MIT
// A button that requires an explicit second confirmation before firing — the in-UI confirm step the
// safety rules require for irreversible money actions (answer, decline, cancel, reclaim, withdraw),
// BEFORE the wallet prompt. First click "arms" the action and reveals a plain-language question with
// Confirm / Keep; only Confirm calls `onConfirm`. Self-contained; no modal, mobile-friendly.

import { type ReactNode, useState } from "react";
import styles from "../question/question.module.css";
import { Button, type ButtonProps } from "./Button";

export interface ConfirmButtonProps extends Omit<ButtonProps, "onClick" | "children"> {
  /** The resting button label (e.g. "Decline question"). */
  children: ReactNode;
  /** The plain-language question shown once armed (e.g. "Decline and refund the asker in full?"). */
  question: ReactNode;
  /** The confirm-action label (e.g. "Yes, decline"). */
  confirmLabel: string;
  /** Fired only when the user confirms. */
  onConfirm: () => void;
}

export function ConfirmButton({
  children,
  question,
  confirmLabel,
  onConfirm,
  ...rest
}: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);

  if (armed) {
    // The confirm action inherits the caller's variant (e.g. `danger` for a decline) but defaults to
    // primary; `disabled` is dropped here so the confirm is always actionable once armed.
    const { disabled: _disabled, variant, ...confirmProps } = rest;
    return (
      <div className={styles.confirm}>
        <span className={styles.confirmText}>{question}</span>
        <div className={styles.actions}>
          <Button
            {...confirmProps}
            variant={variant ?? "primary"}
            onClick={() => {
              setArmed(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
          <Button variant="ghost" onClick={() => setArmed(false)}>
            Keep it
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button {...rest} onClick={() => setArmed(true)}>
      {children}
    </Button>
  );
}
