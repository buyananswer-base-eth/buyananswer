// SPDX-License-Identifier: MIT
// Page objects for the multi-actor harness — every step a real user takes, taken through the real UI.
//
// RULE (the point of this suite): nothing here shortcuts a user action. Transactions are only ever sent
// by clicking the app's own buttons, with the headless wallet answering the wallet prompts; money-state
// is only ever produced by the indexer. The API is read (`/api/me`, `/api/questions/:id`) purely to
// *assert* what the UI produced and to look up ids/deadlines for the report — never to create, settle,
// or advance anything.
//
// Each actor gets its own browser context (its own cookie session + its own injected wallet), so several
// real users are on the app at once, exactly as in production.

import {
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  expect,
} from "@playwright/test";
import { installHeadlessWallet } from "../fixtures/wallet";
import { gotoInteractive } from "../tests/helpers";
import type { Actor } from "./actors";
import { BASE_URL, CHAIN_ID, RPC_URL } from "./env";

/** How long a money step may take: wallet → tx → receipt → indexer reconcile → UI. */
export const MONEY_TIMEOUT = 240_000;

/** One transaction this actor's wallet sent, as observed in Node (never from app state). */
export interface SentTx {
  to: `0x${string}`;
  hash: `0x${string}`;
}

export interface ActorSession {
  actor: Actor;
  context: BrowserContext;
  page: Page;
  /** Every transaction this actor has sent, in order — proves which on-chain path the UI took. */
  sent: SentTx[];
  /** The creator handle this actor owns, once onboarded. */
  handle?: string;
}

/** Transactions this actor sent to `to` since (and including) index `from`. */
export const sentTo = (s: ActorSession, to: string, from = 0): SentTx[] =>
  s.sent.slice(from).filter((tx) => tx.to.toLowerCase() === to.toLowerCase());

/** The API's question projection, as the UI reads it (used for assertions + the run report). */
export interface ApiQuestion {
  id: string;
  status: "pending_payment" | "open" | "answered" | "declined" | "cancelled" | "reclaimed";
  onchainId: string | null;
  amountUsdc: string | null;
  answerDeadline: string | null;
  askerWallet: string;
  answererWallet: string;
  isPublic: boolean;
}

/**
 * Open a browser context for one actor with its headless wallet installed and pointed at Base Sepolia,
 * so transactions the UI initiates really do land on-chain.
 *
 * `signTypedData: false` models a wallet that can't sign EIP-712 — the ask flow then takes its
 * **approve + askQuestion** fallback instead of the EIP-2612 permit (ADR-0027).
 */
export async function openActor(
  browser: Browser,
  actor: Actor,
  opts: { signTypedData?: boolean } = {},
): Promise<ActorSession> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const sent: SentTx[] = [];
  await installHeadlessWallet(context, {
    privateKey: actor.privateKey,
    chainId: CHAIN_ID,
    rpcUrl: RPC_URL,
    onTransaction: ({ to, hash }) => sent.push({ to, hash }),
    ...(opts.signTypedData === false ? { signTypedData: false } : {}),
  });
  const page = await context.newPage();
  return { actor, context, page, sent };
}

// ── auth ────────────────────────────────────────────────────────────────────────────────────────

/** Connect → Sign-In-With-Ethereum. A signature only: no gas, no funds. */
export async function signIn(s: ActorSession): Promise<void> {
  const { page } = s;
  const connectBtn = page.getByRole("button", { name: /e2e wallet|metamask/i });
  const signInBtn = page.getByRole("button", { name: /sign in with ethereum/i });
  const signedIn = page.getByRole("heading", { name: /you're signed in/i });

  await gotoInteractive(page, "/app", connectBtn.or(signInBtn).or(signedIn));
  if (await signedIn.isVisible().catch(() => false)) return;

  // wagmi may still be racing its auto-reconnect; retry the connect click until Sign-In appears.
  await expect(async () => {
    if (await signInBtn.isVisible().catch(() => false)) return;
    await connectBtn
      .first()
      .click({ timeout: 2_000 })
      .catch(() => {});
    await expect(signInBtn).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });

  await signInBtn.click();
  await expect(signedIn).toBeVisible();
}

/**
 * GET a same-origin `/api/*` endpoint **from inside the actor's page**, exactly as the app does — same
 * fetch, same `credentials: "include"`, same HttpOnly session cookie. Used only to assert what the UI
 * produced and to look up ids/deadlines; nothing here mutates anything.
 */
async function apiGet<T>(s: ActorSession, path: string): Promise<T> {
  const result = await s.page.evaluate(async (p) => {
    const res = await fetch(`/api${p}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    return { status: res.status, text: await res.text() };
  }, path);
  expect(result.status, `GET /api${path} for ${s.actor.role} → ${result.text}`).toBe(200);
  return JSON.parse(result.text) as T;
}

/** The signed-in session: the wallet, and its creator profile if it has claimed one. */
export async function readMe(s: ActorSession): Promise<{
  wallet: string;
  creator: { handle: string; minPriceUsdc: string } | null;
}> {
  return apiGet(s, "/me");
}

// ── onboarding ──────────────────────────────────────────────────────────────────────────────────

/**
 * Make sure this actor is a live creator: claim a handle through the onboarding UI if they have none.
 * The harness wallets are persistent, so on later runs the profile already exists — the same thing a
 * returning creator sees — and we reuse it rather than claiming twice.
 */
export async function ensureCreatorProfile(s: ActorSession, prefix: string): Promise<string> {
  const { page } = s;
  const existing = await readMe(s);
  if (existing.creator) {
    s.handle = existing.creator.handle;
    return existing.creator.handle;
  }

  const claimCta = page.getByRole("link", { name: /get started|claim your handle/i });
  await gotoInteractive(page, "/dashboard", claimCta);
  await claimCta.first().click();
  await expect(page).toHaveURL(/\/onboarding/);

  const handle = `${prefix}_${Date.now().toString(36)}`.slice(0, 30);
  await page.getByPlaceholder("yourname").fill(handle);
  await page.getByRole("button", { name: /^claim handle$/i }).click();
  await expect(page).toHaveURL(/\/settings\/profile/, { timeout: 30_000 });

  s.handle = handle;
  return handle;
}

/** Set the board's minimum price through the profile editor (base-unit money, entered as USDC). */
export async function setMinPrice(s: ActorSession, priceUsdc: string): Promise<void> {
  const { page } = s;
  const priceField = page.getByLabel(/minimum price/i);
  await gotoInteractive(page, "/settings/profile", priceField);
  await priceField.fill(priceUsdc);
  await page.getByRole("button", { name: /^save profile$/i }).click();
  await expect(page.getByText(/^saved ✓$/i)).toBeVisible({ timeout: 30_000 });
}

/** The public board is live: it server-renders for an anonymous visitor with the ask CTA. */
export async function expectBoardLive(s: ActorSession, handle: string): Promise<void> {
  const anon = await s.context.browser()?.newContext({ baseURL: BASE_URL });
  if (!anon) throw new Error("could not open an anonymous context");
  try {
    const page = await anon.newPage();
    const res = await page.goto(`/${handle}`);
    expect(res?.status(), `public board /${handle} should be live`).toBe(200);
    await expect(page.getByText(`@${handle}`)).toBeVisible();
    await expect(page.getByRole("link", { name: /ask a question/i })).toHaveAttribute(
      "href",
      `/ask/${handle}`,
    );
  } finally {
    await anon.close();
  }
}

// ── ask + pay ───────────────────────────────────────────────────────────────────────────────────

export interface AskResult {
  /** The question UUID the API minted (also the on-chain `bytes32 ref`). */
  id: string;
  /** The escrow transaction hash, read off the confirmation's explorer link. */
  hash: string | null;
  /** Any app-level errors the flow recovered from via "Try again" (empty on a clean first pass). */
  retries: string[];
}

/**
 * Walk from the creator's public board through its CTA to the compose surface — the real entry point
 * into the ask flow (the asker must already be signed in with the session wallet on Base Sepolia, or
 * `AskGate` shows connect/switch/sign-in instead). Needs no funds, so it's also the no-money smoke
 * check that the whole gate → composer chain still resolves.
 */
export async function openAskComposer(s: ActorSession, handle: string): Promise<void> {
  const { page } = s;
  await page.goto(`/${handle}`);
  const questionField = page.getByLabel(/your question/i);
  await page.getByRole("link", { name: /ask a question/i }).click();
  await expect(page).toHaveURL(new RegExp(`/ask/${handle}`));
  await gotoInteractive(page, `/ask/${handle}`, questionField);
}

/**
 * The full ask journey as a user does it: board → ask CTA → compose → "Ask & pay" → approve/permit +
 * escrow in the wallet → wait for the app's own confirmation, which only appears once the INDEXER has
 * moved the question off `pending_payment`.
 */
export async function askAndPay(
  s: ActorSession,
  { handle, body, amountUsdc }: { handle: string; body: string; amountUsdc: string },
): Promise<AskResult> {
  const { page } = s;
  await openAskComposer(s, handle);

  await page.getByLabel(/your question/i).fill(body);
  await page.getByLabel(/amount \(usdc\)/i).fill(amountUsdc);

  // Capture the id the API mints for this ask (POST /questions → { id }) as it happens.
  const created = page.waitForResponse(
    (r) => r.request().method() === "POST" && /\/api\/questions$/.test(new URL(r.url()).pathname),
    { timeout: 60_000 },
  );
  await page.getByRole("button", { name: /ask & pay/i }).click();
  const createdRes = await created;
  expect(createdRes.status(), "POST /questions should mint a draft").toBe(201);
  const { id } = (await createdRes.json()) as { id: string };

  // The confirmation only renders once the indexer has confirmed the escrow (chain-first, ADR-0027).
  const retries = await awaitOutcome(
    page,
    page.getByRole("heading", { name: /you're all set/i }),
    `ask + pay for ${s.actor.role}`,
  );

  const txLink = page.getByRole("link", { name: /view transaction/i });
  const href = (await txLink.getAttribute("href").catch(() => null)) ?? "";
  const hash = /\/tx\/(0x[0-9a-fA-F]{64})/.exec(href)?.[1] ?? null;
  return { id, hash, retries };
}

// ── question detail + settle ────────────────────────────────────────────────────────────────────

/**
 * Wait for a money flow to reach its success state, recovering the way a user does: if the app shows its
 * error panel, click **Try again** (the flow's own safe-point retry — it re-pays/re-sends the already
 * minted question, it never double-mints) and keep waiting.
 *
 * This is not papering over failures. Base Sepolia's load-balanced RPCs are read-after-write
 * inconsistent: an `eth_call` issued immediately after a transaction's receipt can still be served by a
 * node that hasn't applied that block, so a simulate can revert on state that is already final
 * elsewhere. Every retry is recorded and reported, so a flow that needed one is visible, not hidden.
 */
async function awaitOutcome(
  page: Page,
  success: Locator,
  what: string,
  maxRetries = 3,
): Promise<string[]> {
  const failure = page
    .getByRole("alert")
    .filter({ hasText: /something went wrong|request cancelled/i });
  const tryAgain = page.getByRole("button", { name: /^try again$/i });
  const retries: string[] = [];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const outcome = await Promise.race([
      success
        .first()
        .waitFor({ state: "visible", timeout: MONEY_TIMEOUT })
        .then(() => "done" as const)
        .catch(() => "timeout" as const),
      failure
        .first()
        .waitFor({ state: "visible", timeout: MONEY_TIMEOUT })
        .then(() => "error" as const)
        .catch(() => "timeout" as const),
    ]);
    if (outcome === "done") return retries;
    if (outcome !== "error" || attempt === maxRetries) break;

    retries.push((await failure.first().innerText()).replace(/\s+/g, " ").trim());
    await tryAgain.first().click();
    await failure
      .first()
      .waitFor({ state: "hidden", timeout: 30_000 })
      .catch(() => {});
  }

  // Final assertion, so a genuine failure reports what the app actually said.
  const tail = retries.length
    ? ` — after ${retries.length} UI retry/retries: ${retries.join(" | ")}`
    : "";
  await expect(success.first(), `${what} never completed${tail}`).toBeVisible({ timeout: 15_000 });
  return retries;
}

/**
 * Every irreversible money action is behind an inline `ConfirmButton`: the first click arms it and
 * reveals a plain-language question with Confirm / "Keep it"; only the second click fires (ADR-0028).
 * Waiting for "Keep it" between the clicks makes that two-step deterministic — and asserts the safety
 * gate is actually there. `confirm` may be the same locator as `resting` when the labels match.
 */
async function armAndConfirm(page: Page, resting: Locator, confirm: Locator): Promise<void> {
  await resting.click();
  await expect(page.getByRole("button", { name: "Keep it", exact: true })).toBeVisible();
  await confirm.click();
}

/**
 * Read a question the way the UI does (participant-scoped, cookie session) — assertions only. The
 * `answer` field is exactly what the paywall governs: null until the indexer writes `answered`.
 */
export async function readQuestionDetail(
  s: ActorSession,
  id: string,
): Promise<{ question: ApiQuestion; answer: { body: string } | null }> {
  return apiGet(s, `/questions/${id}`);
}

export async function readQuestion(s: ActorSession, id: string): Promise<ApiQuestion> {
  return (await readQuestionDetail(s, id)).question;
}

/** Open `/questions/:id` and wait for the detail card to render (its back-link is always present). */
export async function openQuestion(s: ActorSession, id: string): Promise<void> {
  await gotoInteractive(
    s.page,
    `/questions/${id}`,
    s.page.getByRole("link", { name: /back to dashboard/i }),
  );
}

/**
 * The paywall, from the asker's side of an OPEN question: no Answer card in the UI, and the API's
 * participant-scoped detail carries no answer body either (it keys on the indexer-written `answered`,
 * ADR-0023). Optionally also asserts a specific string appears nowhere in the rendered page.
 */
export async function expectAnswerHidden(
  s: ActorSession,
  id: string,
  absentText?: string,
): Promise<void> {
  await openQuestion(s, id);
  await expect(s.page.getByText("Open", { exact: true }).first()).toBeVisible();
  await expect(s.page.getByRole("heading", { name: "Answer", exact: true })).toHaveCount(0);

  const detail = await readQuestionDetail(s, id);
  expect(detail.question.status, "still open").toBe("open");
  expect(
    detail.answer,
    "the API must not hand an answer to the asker before it's settled",
  ).toBeNull();

  if (absentText) {
    const content = await s.page.content();
    expect(content.includes(absentText), "no answer text may reach the asker yet").toBe(false);
  }
}

/** After settling, the asker sees the revealed answer on the same page. */
export async function expectAnswerVisible(
  s: ActorSession,
  id: string,
  answerText: string,
): Promise<void> {
  await openQuestion(s, id);
  await expect(s.page.getByRole("heading", { name: "Answer", exact: true })).toBeVisible();
  await expect(s.page.getByText(answerText, { exact: false })).toBeVisible();
}

/** Creator answers: write the hidden draft, confirm, sign the on-chain answer, wait for the reveal. */
export async function answerQuestion(s: ActorSession, id: string, text: string): Promise<string[]> {
  const { page } = s;
  const draft = page.getByPlaceholder(/write your answer/i);
  await gotoInteractive(page, `/questions/${id}`, draft);
  await draft.fill(text);

  // Confirm → save the draft (the tx's preflight) → answerQuestion tx → receipt → indexer → reveal.
  const button = page.getByRole("button", { name: "Answer & get paid", exact: true });
  await armAndConfirm(page, button, button);

  const retries = await awaitOutcome(
    page,
    page.getByRole("heading", { name: "Answer", exact: true }),
    `answer by ${s.actor.role}`,
  );
  await expect(page.getByText(text, { exact: false })).toBeVisible();
  return retries;
}

/** Creator declines: the asker is refunded 100%. */
export async function declineQuestion(s: ActorSession, id: string): Promise<string[]> {
  const { page } = s;
  const resting = page.getByRole("button", { name: "Decline & refund", exact: true });
  await gotoInteractive(page, `/questions/${id}`, resting);
  await armAndConfirm(
    page,
    resting,
    page.getByRole("button", { name: "Yes, decline", exact: true }),
  );
  return awaitOutcome(page, page.getByText(/you declined this question/i), "decline");
}

/** Asker cancels before the deadline: refunded minus the cancel fee. */
export async function cancelQuestion(s: ActorSession, id: string): Promise<string[]> {
  const { page } = s;
  const resting = page.getByRole("button", { name: "Cancel & refund", exact: true });
  await gotoInteractive(page, `/questions/${id}`, resting);
  await armAndConfirm(
    page,
    resting,
    page.getByRole("button", { name: "Yes, cancel & refund", exact: true }),
  );
  return awaitOutcome(page, page.getByText(/you cancelled this question/i), "cancel");
}

/** Asker reclaims after the 7-day window: refunded in full, no fee. */
export async function reclaimQuestion(s: ActorSession, id: string): Promise<string[]> {
  const { page } = s;
  const button = page.getByRole("button", { name: "Reclaim my funds", exact: true });
  await gotoInteractive(page, `/questions/${id}`, button);
  await armAndConfirm(page, button, button);
  return awaitOutcome(page, page.getByText(/you got your full payment back/i), "reclaim");
}

/** Publish the answered Q&A as a public card. */
export async function publishAnswer(s: ActorSession, id: string): Promise<void> {
  const { page } = s;
  const publish = page.getByRole("button", { name: /publish this q&a/i });
  await gotoInteractive(page, `/questions/${id}`, publish);
  await publish.click();
  await expect(page.getByText(/this q&a is public/i)).toBeVisible({ timeout: 60_000 });
}

// ── withdraw ────────────────────────────────────────────────────────────────────────────────────

/**
 * Pull the whole withdrawable balance out through the dashboard's Withdraw card. Settlements only
 * *credit* the escrow's ledger; `withdraw()` is the only way money reaches a wallet (ADR-0028).
 */
export async function withdrawAll(s: ActorSession): Promise<void> {
  const { page } = s;
  const button = page.getByRole("button", { name: "Withdraw", exact: true });
  await gotoInteractive(page, "/dashboard", page.getByText(/available to withdraw/i));
  await expect(button).toBeVisible({ timeout: 60_000 });

  // The Withdraw card renders its own error line with no "Try again", so the user's retry here is
  // simply pressing Withdraw again. Same rationale as awaitOutcome: RPC read-after-write lag.
  const done = page.getByText(/withdrawn ✓/i);
  const failed = page.getByRole("alert");
  for (let attempt = 0; attempt < 3; attempt++) {
    await armAndConfirm(page, button, button);
    const outcome = await Promise.race([
      done
        .waitFor({ state: "visible", timeout: MONEY_TIMEOUT })
        .then(() => "done" as const)
        .catch(() => "timeout" as const),
      failed
        .first()
        .waitFor({ state: "visible", timeout: MONEY_TIMEOUT })
        .then(() => "error" as const)
        .catch(() => "timeout" as const),
    ]);
    if (outcome === "done") return;
    if (outcome !== "error") break;
    await expect(button).toBeVisible({ timeout: 30_000 });
  }
  await expect(done, `withdraw for ${s.actor.role} never confirmed`).toBeVisible({
    timeout: 15_000,
  });
}
