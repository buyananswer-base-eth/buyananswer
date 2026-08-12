// SPDX-License-Identifier: MIT
// Test helpers: a fake FrameVerifier (no live hub), D1 seeding/reading via the real Drizzle client
// against the Miniflare `env.DB`, and a builder for a realistic frame POST body. Tests seed a creator
// the way the API would, drive the app with a scripted verified action, and assert the tx responses +
// the minted `pending_payment` row (never any money-state column).

import { env } from "cloudflare:test";
import { creators, questions } from "@buyananswer/shared";
import { eq } from "drizzle-orm";
import type { createApp } from "../src/app.js";
import { getDb } from "../src/db.js";
import type { FramePostBody, VerifiedFrameAction } from "../src/frame/message.js";
import type { FrameVerifier } from "../src/frame/verify.js";

/** The Hono app returned by `createApp` — what `get`/`postAction` drive. */
export type App = ReturnType<typeof createApp>;

type Hex = `0x${string}`;

export const ASKER: Hex = "0x1111111111111111111111111111111111111111";
export const ANSWERER: Hex = "0x2222222222222222222222222222222222222222";

export function db() {
  return getDb(env);
}

/** Seed a creator the way the API's onboarding would. Returns the wallet + min price. */
export async function seedCreator(
  over: { handle?: string; wallet?: Hex; displayName?: string; minPriceUsdc?: string } = {},
) {
  const handle = over.handle ?? "satoshi";
  const wallet = over.wallet ?? ANSWERER;
  const minPriceUsdc = over.minPriceUsdc ?? "2000000";
  await db()
    .insert(creators)
    .values({
      wallet,
      handle,
      displayName: over.displayName ?? "Satoshi",
      minPriceUsdc,
    });
  return { handle, wallet, minPriceUsdc };
}

export async function getQuestionRow(id: string) {
  return db().select().from(questions).where(eq(questions.id, id)).get();
}

export async function allQuestions() {
  return db().select().from(questions).all();
}

/** A fake verifier: returns a scripted verified action (or null to simulate a rejected signature). */
export class FakeVerifier implements FrameVerifier {
  constructor(private readonly action: VerifiedFrameAction | null) {}
  async verify(): Promise<VerifiedFrameAction | null> {
    return this.action;
  }
}

/** A verified action with sensible defaults for the ask flow (override per test). */
export function verifiedAction(over: Partial<VerifiedFrameAction> = {}): VerifiedFrameAction {
  return {
    fid: 42,
    buttonIndex: 1,
    inputText: "why is the sky blue?",
    state: "",
    address: ASKER,
    ...over,
  };
}

/** A minimal, well-formed frame POST body (the fake verifier ignores its contents). */
export function framePostBody(over: Partial<FramePostBody["untrustedData"]> = {}): FramePostBody {
  return {
    untrustedData: {
      fid: 42,
      url: "https://frame.test/f/satoshi",
      messageHash: "0xabcd",
      timestamp: 1_700_000_000,
      network: 1,
      buttonIndex: 1,
      ...over,
    },
    trustedData: { messageBytes: "0xdeadbeef" },
  };
}

/** The origin the tests hit, so target/post_url URLs derive predictably as `https://frame.test/...`. */
export const FRAME_ORIGIN = "https://frame.test";

/** GET a path on the app (env from `cloudflare:test`). */
export async function get(app: App, path: string): Promise<Response> {
  return app.fetch(new Request(`${FRAME_ORIGIN}${path}`), env);
}

/** POST a frame action to the app and return the Response. */
export async function postAction(
  app: App,
  path: string,
  body: FramePostBody = framePostBody(),
): Promise<Response> {
  return app.fetch(
    new Request(`${FRAME_ORIGIN}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );
}
