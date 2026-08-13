// SPDX-License-Identifier: MIT
// Typed client for the Worker API. Every call is same-origin under `/api/*` (the dev server proxies
// it to the API Worker; in production Pages proxies it), and every call sends `credentials: "include"`
// so the HttpOnly `ba_session` cookie (ADR-0022) rides along. The API's error envelope is
// `{ error, message? }`; non-2xx responses become an {@link ApiError}, transport failures a
// {@link NetworkError}, so the UI can distinguish server errors from network failures (§10 states).

import type { Address, QuestionStatus } from "@buyananswer/shared";

const API_BASE = "/api";

/** The API's JSON error body. */
export interface ApiErrorBody {
  error: string;
  message?: string;
  issues?: unknown;
}

/** A non-2xx response carrying the API's error envelope. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: ApiErrorBody | undefined;

  constructor(status: number, body: ApiErrorBody | undefined) {
    super(body?.message ?? body?.error ?? `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.error ?? "unknown_error";
    this.body = body;
  }
}

/** The request never reached the server (offline, DNS, CORS, API not running). */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super("Network error — could not reach the server.");
    this.name = "NetworkError";
    this.cause = cause;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (cause) {
    throw new NetworkError(cause);
  }

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) throw new ApiError(res.status, data as ApiErrorBody | undefined);
  return data as T;
}

/** A profile link (label + url) as exposed by the API. */
export interface ProfileLink {
  label: string;
  url: string;
}

/** Owner-facing creator profile (from `GET /me`). */
export interface CreatorProfile {
  wallet: Address;
  handle: string;
  displayName: string;
  headline: string | null;
  bio: string | null;
  avatarUrl: string | null;
  links: ProfileLink[] | null;
  minPriceUsdc: string;
  createdAt: number;
  updatedAt: number;
}

/** `GET /me` — the signed-in wallet + its creator profile (or null if none claimed yet). */
export interface Me {
  wallet: Address;
  creator: CreatorProfile | null;
}

/** Fetch the current session. Returns null when unauthenticated (401), throws otherwise. */
export async function getMe(): Promise<Me | null> {
  try {
    return await request<Me>("/me");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

/** `POST /auth/nonce` — issue a single-use SIWE nonce. */
export function getNonce(): Promise<{ nonce: string }> {
  return request<{ nonce: string }>("/auth/nonce", { method: "POST" });
}

/** `POST /auth/verify` — verify the signed SIWE message; sets the session cookie on success. */
export function postVerify(input: {
  message: string;
  signature: `0x${string}`;
}): Promise<{ wallet: Address }> {
  return request<{ wallet: Address }>("/auth/verify", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** `POST /auth/logout` — destroy the session + clear the cookie. */
export async function postLogout(): Promise<void> {
  await request<{ ok: true }>("/auth/logout", { method: "POST" });
}

/** Public board projection (`GET /board/:handle`) — no private fields (no `updatedAt`). */
export interface PublicCreator {
  wallet: Address;
  handle: string;
  displayName: string;
  headline: string | null;
  bio: string | null;
  avatarUrl: string | null;
  links: ProfileLink[] | null;
  minPriceUsdc: string;
  createdAt: number;
}

/** Fetch a public board (`GET /board/:handle`). Throws {@link ApiError} 404 when unclaimed. */
export async function getBoard(handle: string): Promise<PublicCreator> {
  const data = await request<{ creator: PublicCreator }>(`/board/${encodeURIComponent(handle)}`);
  return data.creator;
}

/** Body for `POST /questions` — the asker composes a question for a creator (by handle). */
export interface CreateQuestionInput {
  handle: string;
  body: string;
  /** The intended escrow amount in USDC base units (text). Gates against the creator's min price; the
   * API never persists it — money-state is indexer-only (ADR-0021). */
  amountUsdc: string;
  /** The chain the ask will be paid on (defaults server-side to Base Sepolia). */
  chainId?: number;
}

/**
 * `POST /questions` — mint the off-chain draft (a `pending_payment` row) and get its UUID back. The
 * chain-first ordering (session brief): call THIS first, then send the `askQuestion` tx with the UUID
 * encoded as the `bytes32 ref`. The question only becomes `open` once the indexer sees `QuestionAsked`.
 */
export function postQuestion(input: CreateQuestionInput): Promise<{ id: string }> {
  return request<{ id: string }>("/questions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * A question record as echoed by `GET /questions/:id` (money-state columns are read-only mirrors).
 * Timestamp columns (`answerDeadline`/`createdAt`/`updatedAt`) are Drizzle `Date`s serialized by the
 * Worker's `JSON.stringify` → **ISO-8601 strings** on the wire (not epoch numbers). Parse via
 * `toEpochMs` in `lib/format`; the lifecycle helpers accept either form.
 */
export interface QuestionRecord {
  id: string;
  chainId: number;
  onchainId: string | null;
  askerWallet: Address;
  answererWallet: Address;
  amountUsdc: string | null;
  body: string;
  status: QuestionStatus;
  answerDeadline: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The gated answer sub-object (body present only when the paywall is open). ISO-8601 timestamps. */
export interface QuestionAnswer {
  submittedAt: string;
  updatedAt: string;
  revealedAt: string | null;
  locked: boolean;
  body?: string;
}

/** `GET /questions/:id` detail response. */
export interface QuestionDetail {
  question: QuestionRecord;
  answer: QuestionAnswer | null;
}

/**
 * `GET /questions/:id` — participant-only detail. Used to poll for the indexer-written `open` status
 * after paying (the client never marks a question paid itself; chain is the source of truth).
 */
export function getQuestion(id: string): Promise<QuestionDetail> {
  return request<QuestionDetail>(`/questions/${encodeURIComponent(id)}`);
}

/** A row in an inbox/history list — the question record plus whether a hidden answer draft exists. */
export interface QuestionListItem extends QuestionRecord {
  hasAnswer: boolean;
}

/** A paginated list response (`GET /questions/received | /questions/asked`). */
export interface QuestionList {
  questions: QuestionListItem[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

/** Optional pagination controls (defaults mirror the API: limit 20, offset 0). */
export interface ListParams {
  limit?: number;
  offset?: number;
}

function listQs({ limit, offset }: ListParams = {}): string {
  const qs = new URLSearchParams();
  if (limit !== undefined) qs.set("limit", String(limit));
  if (offset !== undefined) qs.set("offset", String(offset));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/** `GET /questions/received` — the answerer's inbox (own rows), paginated, newest-first. */
export function getReceived(params?: ListParams): Promise<QuestionList> {
  return request<QuestionList>(`/questions/received${listQs(params)}`);
}

/** `GET /questions/asked` — the asker's history (own rows), paginated, newest-first. */
export function getAsked(params?: ListParams): Promise<QuestionList> {
  return request<QuestionList>(`/questions/asked${listQs(params)}`);
}

/**
 * `POST /questions/:id/answer` — the answerer saves/replaces the HIDDEN answer body. Must happen BEFORE
 * the on-chain `answerQuestion` tx: the indexer marks the question `answered` from chain truth even with
 * no draft, and this route then 409s (`answer_locked`). Returns the (author-visible) answer sub-object.
 */
export function postAnswer(id: string, body: string): Promise<{ answer: QuestionAnswer }> {
  return request<{ answer: QuestionAnswer }>(`/questions/${encodeURIComponent(id)}/answer`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

/** `POST /questions/:id/publish` — the answerer opts an answered Q→A into the public card (`is_public`). */
/**
 * Ask the indexer to reconcile now rather than on its next cron tick.
 *
 * A pure latency optimisation, and deliberately best-effort: it NEVER throws, so a failed nudge can
 * never surface as an error in the middle of someone's payment. If it doesn't land, the cron still
 * reconciles and the poll still resolves — just slower, exactly as before this existed.
 *
 * Called on every poll tick, not once: the indexer only scans to `head - CONFIRMATIONS`, so a nudge
 * fired the instant a receipt lands would scan past the new event and find nothing.
 */
export async function postReconcileNudge(): Promise<void> {
  try {
    await request<{ nudged: boolean }>("/reconcile-nudge", { method: "POST" });
  } catch {
    // Intentionally swallowed — see above.
  }
}

export function postPublish(id: string): Promise<{ question: QuestionRecord }> {
  return request<{ question: QuestionRecord }>(`/questions/${encodeURIComponent(id)}/publish`, {
    method: "POST",
  });
}

/** Body for `POST /handle/claim`. `minPriceUsdc` is base-unit text (never a float). */
export interface ClaimHandleInput {
  handle: string;
  displayName?: string;
  minPriceUsdc?: string;
}

/** Patch for `PUT /profile`. Every field optional; `null` clears a nullable column. */
export interface ProfilePatch {
  displayName?: string;
  headline?: string | null;
  bio?: string | null;
  links?: ProfileLink[] | null;
  minPriceUsdc?: string;
}

/** `POST /handle/claim` — create the creator profile for the session wallet. */
export function postClaimHandle(input: ClaimHandleInput): Promise<{ creator: CreatorProfile }> {
  return request<{ creator: CreatorProfile }>("/handle/claim", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** `PUT /profile` — edit the owner's profile fields. */
export function putProfile(patch: ProfilePatch): Promise<{ creator: CreatorProfile }> {
  return request<{ creator: CreatorProfile }>("/profile", {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

/**
 * `POST /avatar` — raw image upload. Bypasses the JSON {@link request} helper because the body is
 * raw image bytes with the file's own content-type (the server enforces type/size/magic-byte).
 */
export async function postAvatar(
  file: File,
): Promise<{ avatarUrl: string; creator: CreatorProfile }> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/avatar`, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json", "Content-Type": file.type },
      body: file,
    });
  } catch (cause) {
    throw new NetworkError(cause);
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) throw new ApiError(res.status, data as ApiErrorBody | undefined);
  return data as { avatarUrl: string; creator: CreatorProfile };
}
