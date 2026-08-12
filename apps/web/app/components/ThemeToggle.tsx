// SPDX-License-Identifier: MIT
// Theme toggle. Hydration-safe so it can render during SSR (the public board frame): the persisted
// preference is only known on the client (the pre-paint script reads localStorage), so until mounted
// we render a stable neutral icon that matches on server and first client render, then swap to the
// real state. This avoids a hydration mismatch when the saved theme differs from the SSR default.

import { useEffect, useState } from "react";
import { useTheme } from "../hooks/useTheme";
import styles from "./ThemeToggle.module.css";

const ICON = { light: "☀", dark: "☾", system: "◐" } as const;

export function ThemeToggle() {
  const { pref, toggle } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const label = mounted ? `Theme: ${pref} (click to switch)` : "Toggle theme";
  return (
    <button
      type="button"
      className={styles.toggle}
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">{mounted ? ICON[pref] : ICON.system}</span>
    </button>
  );
}
