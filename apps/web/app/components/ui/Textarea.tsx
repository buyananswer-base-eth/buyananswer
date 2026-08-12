// SPDX-License-Identifier: MIT
// A labelled textarea with hint/error slots and an optional live character counter — reuses Input's
// CSS module so form fields stay visually consistent.

import type { TextareaHTMLAttributes } from "react";
import { useId } from "react";
import { cx } from "../../lib/cx";
import styles from "./Input.module.css";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  /** Show a `used / max` counter next to the label (uses `maxLength` and the current value length). */
  showCount?: boolean | undefined;
}

export function Textarea({
  label,
  hint,
  error,
  showCount,
  id,
  className,
  maxLength,
  value,
  ...rest
}: TextareaProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  const used = typeof value === "string" ? value.length : 0;
  const over = maxLength !== undefined && used > maxLength;

  return (
    <div className={styles.field}>
      {label || (showCount && maxLength !== undefined) ? (
        <div className={styles.labelRow}>
          {label ? (
            <label htmlFor={fieldId} className={styles.label}>
              {label}
            </label>
          ) : (
            <span />
          )}
          {showCount && maxLength !== undefined ? (
            <span className={cx(styles.count, over && styles.countOver)}>
              {used}/{maxLength}
            </span>
          ) : null}
        </div>
      ) : null}
      <textarea
        id={fieldId}
        className={cx(
          styles.input,
          styles.textarea,
          error ? styles.inputError : undefined,
          className,
        )}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        maxLength={maxLength}
        value={value}
        {...rest}
      />
      {error ? (
        <p id={`${fieldId}-error`} className={styles.error}>
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
