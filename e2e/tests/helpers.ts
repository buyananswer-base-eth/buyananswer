// SPDX-License-Identifier: MIT
// Shared E2E helpers.

import { type Locator, type Page, expect } from "@playwright/test";

/**
 * Navigate to an INTERACTIVE route (one inside the wallet boundary — /app, /ask/:handle, /dashboard,
 * /onboarding, /questions/:id) and settle deterministically.
 *
 * The dev server bundles the wallet libs (wagmi/viem) lazily — they're dynamically imported inside an
 * effect so SSR never touches them (ADR-0025). On a COLD `.vite` cache the first such load makes Vite
 * optimize those deps and trigger a one-time full reload, which briefly double-loads React and throws
 * "Cannot read properties of null (reading 'useContext')" on an "Application Error" page. This is a
 * documented dev-only artifact (PROGRESS, Sessions 11–12) — the production build never does it. We
 * self-heal by reloading through that single event, so interactive assertions are stable in CI.
 */
export async function gotoInteractive(page: Page, path: string, ready: Locator): Promise<void> {
  const appError = page.getByText(/application error/i);
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt === 0) {
      await page.goto(path);
    } else {
      await page.reload();
    }
    const outcome = await Promise.race([
      ready
        .first()
        .waitFor({ state: "visible", timeout: 20_000 })
        .then(() => "ready" as const)
        .catch(() => "timeout" as const),
      appError
        .waitFor({ state: "visible", timeout: 20_000 })
        .then(() => "error" as const)
        .catch(() => "timeout" as const),
    ]);
    if (outcome === "ready") return;
    // "error" (the transient reload) or "timeout": reload with the now-warm cache and retry.
  }
  await expect(ready.first()).toBeVisible(); // final attempt with a clear assertion failure
}
