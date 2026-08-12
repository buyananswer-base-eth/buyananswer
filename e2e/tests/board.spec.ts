// SPDX-License-Identifier: MIT
// Public, no-wallet journeys — the surfaces that must server-render for anonymous visitors and
// crawlers (Sessions 9–13). These need only the web app + API (no wallet, no funds, no indexer), so
// they run on every nightly and are the fastest signal that the SSR stack is healthy end-to-end.

import { expect, test } from "@playwright/test";
import { gotoInteractive } from "./helpers";

test.describe("public surfaces (no wallet)", () => {
  test("the marketing landing renders and funnels into the app", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/BuyAnAnswer/i);
    // The single funnel into the app (landing nav + CTA both say "Enter App").
    await expect(page.getByRole("link", { name: /enter app/i }).first()).toBeVisible();
  });

  test("a seeded creator's public board server-renders with the ask CTA", async ({ page }) => {
    const res = await page.goto("/satoshi");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Satoshi" })).toBeVisible();
    await expect(page.getByText("@satoshi")).toBeVisible();
    // The CTA links to the interactive ask + pay page (Session 11).
    await expect(page.getByRole("link", { name: /ask a question/i })).toHaveAttribute(
      "href",
      "/ask/satoshi",
    );
    // Per-handle SSR title (Session 10 OG/meta).
    await expect(page).toHaveTitle(/Satoshi/);
  });

  test("an unclaimed handle returns a 404 with a friendly board", async ({ page }) => {
    const res = await page.goto("/definitely-not-a-real-handle-xyz");
    expect(res?.status()).toBe(404);
    await expect(page.getByText(/no creator here yet/i)).toBeVisible();
  });

  test("the ask page gates on sign-in when no wallet/session is present", async ({ page }) => {
    // AskGate → AskSignIn: the interactive boundary hydrates, /me is unauthenticated → sign-in prompt.
    const lead = page.getByText(/sign in with your wallet/i);
    await gotoInteractive(page, "/ask/satoshi", lead);
    await expect(lead).toBeVisible();
  });
});
