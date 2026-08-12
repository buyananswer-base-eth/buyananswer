// SPDX-License-Identifier: MIT
// The shape of a Farcaster frame action POST (what a client sends when a button is pressed) and the
// clean, VERIFIED action our handlers act on. We NEVER trust `untrustedData` for anything that grants
// authority — the asker identity, the question text, and the frame state all come from the hub-
// validated message (see verify.ts). `untrustedData` is retained only so the verifier has the
// `messageBytes` to submit and so tests can construct realistic payloads.

import type { Address } from "@buyananswer/shared";

/** The client-reported (UNTRUSTED) fields of a frame action. Never act on these directly. */
export interface FrameUntrustedData {
  fid: number;
  url: string;
  messageHash: string;
  timestamp: number;
  network: number;
  buttonIndex: number;
  inputText?: string;
  state?: string;
  /** The connected wallet for a transaction frame (the address that will send the tx). */
  address?: string;
  /** The submitted transaction hash, present on the post-tx `post_url` callback. */
  transactionId?: string;
  castId?: { fid: number; hash: string };
}

/** The signed message envelope. `messageBytes` is the hex-encoded protobuf the hub re-verifies. */
export interface FrameTrustedData {
  messageBytes: string;
}

/** A frame action POST body. */
export interface FramePostBody {
  clientProtocol?: string;
  untrustedData: FrameUntrustedData;
  trustedData: FrameTrustedData;
}

/**
 * The VERIFIED frame action — every field here has been re-derived from the hub-validated protobuf,
 * not read off `untrustedData`. `address` is the connected wallet (the asker); `inputText` is the
 * question; `state` round-trips our own frame state (the question id across steps).
 */
export interface VerifiedFrameAction {
  /** The Farcaster id of the signer (proves a real, signed action). */
  fid: number;
  /** 1-based index of the pressed button. */
  buttonIndex: number;
  /** The text-input value (the question), '' when absent. */
  inputText: string;
  /** Our echoed frame state (base64url of `{ qid }`), '' when absent. */
  state: string;
  /** The connected wallet that will send / sent the transaction (lowercased), if present. */
  address?: Address | undefined;
  /** The submitted transaction hash (0x-hex), present on the post-tx callback. */
  transactionId?: string | undefined;
}

/** Parse + minimally shape-check a frame POST body. Throws on a body that isn't a frame action. */
export function parseFramePostBody(raw: unknown): FramePostBody {
  if (typeof raw !== "object" || raw === null) throw new Error("frame body is not an object");
  const body = raw as Partial<FramePostBody>;
  const untrusted = body.untrustedData;
  const trusted = body.trustedData;
  if (!untrusted || typeof untrusted !== "object") throw new Error("missing untrustedData");
  if (!trusted || typeof trusted.messageBytes !== "string") throw new Error("missing messageBytes");
  // We only ever act on `trustedData` (via the hub) — `clientProtocol` is not retained.
  return { untrustedData: untrusted, trustedData: trusted };
}
