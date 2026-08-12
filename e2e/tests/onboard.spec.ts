// SPDX-License-Identifier: MIT
// The onboard critical journey with a HEADLESS wallet — connect → Sign-In-With-Ethereum → claim a
// handle → the public board goes live. SIWE is just a signature, so this needs NO funds and NO chain:
// it runs on every nightly and exercises the real API (nonce → verify → cookie session), the client-
// only wallet boundary (ADR-0025), and onboarding (ADR-0026) end-to-end in a browser.

import { expect, test } from "@playwright/test";
import { generatePrivateKey } from "viem/accounts";
import { installHeadlessWallet } from "../fixtures/wallet";
import { gotoInteractive } from "./helpers";

const BASE_SEPOLIA = 84532;

test("onboard: connect → sign in → claim a handle → board is live", async ({ page, context }) => {
  // A FRESH wallet each run → a brand-new user with no prior profile (onboard needs no funds, just a
  // signature), so the test is self-isolating against the persisted local D1.
  await installHeadlessWallet(context, { privateKey: generatePrivateKey(), chainId: BASE_SEPOLIA });

  // The wallet boundary hydrates. wagmi auto-reconnects the (already-authorized) injected wallet and
  // jumps to Sign-In; if it instead shows the connect step, click the connector (retrying through the
  // reconnect race that detaches the button).
  const connectBtn = page.getByRole("button", { name: /e2e wallet|metamask/i });
  const signIn = page.getByRole("button", { name: /sign in with ethereum/i });
  await gotoInteractive(page, "/app", connectBtn.or(signIn));
  await expect(async () => {
    if (await signIn.isVisible().catch(() => false)) return;
    await connectBtn
      .first()
      .click({ timeout: 2000 })
      .catch(() => {});
    await expect(signIn).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });

  // Sign in with Ethereum (a signature — the headless wallet signs the SIWE message in Node).
  await signIn.click();

  // Authenticated: the cookie session resolves via /me.
  await expect(page.getByRole("heading", { name: /you're signed in/i })).toBeVisible();

  // Claim a fresh, unique handle (3–30 chars, lowercase/digits/underscore).
  await page.getByRole("link", { name: /claim your handle/i }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  const handle = `e2e_${Date.now().toString(36)}`.slice(0, 30);
  await page.getByPlaceholder("yourname").fill(handle);
  await page.getByRole("button", { name: /^claim handle$/i }).click();

  // End-to-end proof: the just-claimed handle now server-renders a public board for anonymous visitors.
  await expect(async () => {
    const res = await page.goto(`/${handle}`);
    expect(res?.status()).toBe(200);
  }).toPass({ timeout: 20_000 });
  await expect(page.getByText(`@${handle}`)).toBeVisible();
});
