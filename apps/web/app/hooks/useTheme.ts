// SPDX-License-Identifier: MIT
// Light/dark theme preference. The source of truth is the `data-theme` attribute on <html> (stamped
// pre-paint by the inline script in root.tsx to avoid a flash), mirrored to localStorage. "system"
// clears the attribute so the OS `prefers-color-scheme` wins. Used only inside client-only UI, so
// reading the DOM/localStorage during render is safe here.

import { useCallback, useState } from "react";

export type ThemePref = "light" | "dark" | "system";

const STORAGE_KEY = "ba-theme";

function readInitial(): ThemePref {
  if (typeof document === "undefined") return "system";
  const attr = document.documentElement.dataset.theme;
  return attr === "light" || attr === "dark" ? attr : "system";
}

export interface UseTheme {
  pref: ThemePref;
  setTheme: (next: ThemePref) => void;
  toggle: () => void;
}

export function useTheme(): UseTheme {
  const [pref, setPref] = useState<ThemePref>(readInitial);

  const setTheme = useCallback((next: ThemePref) => {
    setPref(next);
    try {
      if (next === "system") {
        delete document.documentElement.dataset.theme;
        localStorage.removeItem(STORAGE_KEY);
      } else {
        document.documentElement.dataset.theme = next;
        localStorage.setItem(STORAGE_KEY, next);
      }
    } catch {
      /* private-mode / storage disabled — the toggle still works for this page view */
    }
  }, []);

  const toggle = useCallback(() => {
    const prefersDark =
      typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const effective = pref === "system" ? (prefersDark ? "dark" : "light") : pref;
    setTheme(effective === "dark" ? "light" : "dark");
  }, [pref, setTheme]);

  return { pref, setTheme, toggle };
}
