// SPDX-License-Identifier: MIT
// Server-side frame-signature validation — the security boundary for every frame POST. A frame action
// is only acted on after a Farcaster HUB re-verifies its `messageBytes` (the signed protobuf) and
// returns the true `fid` + action data. This mirrors the codebase's boundary+mock pattern (the
// indexer's ChainReader): a production `HubFrameVerifier` talks to a configurable hub, and tests inject
// a fake so they never hit the network.
//
// FAIL-CLOSED: any failure — no hub configured, transport error, non-200, `valid !== true`, or a
// missing fid — returns `null` (the handler rejects the action). We never fall back to `untrustedData`.

import type { Address } from "@buyananswer/shared";
import { log } from "../log.js";
import type { FramePostBody, VerifiedFrameAction } from "./message.js";

/** The frame-verification boundary. Returns the verified action, or `null` to reject (fail-closed). */
export interface FrameVerifier {
  verify(body: FramePostBody): Promise<VerifiedFrameAction | null>;
}

const utf8 = new TextDecoder();

/** Decode a base64 (standard or url-safe) string to bytes, or `null` if it isn't valid base64. */
function base64ToBytes(value: string): Uint8Array | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

const bytesToHex = (bytes: Uint8Array): `0x${string}` =>
  `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;

/**
 * Decode a protobuf `bytes` field that a hub may render as base64 (raw hubble) OR as a literal string
 * (some gateways pre-decode). Returns the UTF-8 text — used for `inputText`, `state`, `url`.
 */
function bytesFieldToText(value: unknown): string {
  if (typeof value !== "string" || value === "") return "";
  const bytes = base64ToBytes(value);
  if (bytes) {
    const text = utf8.decode(bytes);
    // If it decodes to printable text without replacement chars, it was base64-encoded text.
    if (!text.includes("�")) return text;
  }
  return value;
}

/**
 * Decode a protobuf `bytes` field that represents an address / hash — a hub may render it as a `0x`
 * hex string (Neynar) or as base64 (raw hubble). Returns lowercased `0x`-hex, or '' when absent.
 */
function bytesFieldToHex(value: unknown): string {
  if (typeof value !== "string" || value === "") return "";
  if (value.startsWith("0x")) return value.toLowerCase();
  const bytes = base64ToBytes(value);
  return bytes ? bytesToHex(bytes) : "";
}

/** A `0x`-hex, 40-nibble address → lowercased Address, else undefined. */
function asAddress(hex: string): Address | undefined {
  return /^0x[0-9a-f]{40}$/.test(hex) ? (hex as Address) : undefined;
}

/**
 * Production verifier: submits `messageBytes` to a Farcaster hub's `validateMessage` endpoint and maps
 * the verified message to a {@link VerifiedFrameAction}. Handles the two common JSON shapes (raw
 * hubble base64 bytes fields, and pre-decoded gateway strings) defensively; anything unexpected fails
 * closed. Live hub validation is exercised in a frame debugger / manual E2E (like the indexer's RPC).
 */
export class HubFrameVerifier implements FrameVerifier {
  constructor(
    private readonly hubUrl: string | undefined,
    private readonly hubAuth?: string,
  ) {}

  async verify(body: FramePostBody): Promise<VerifiedFrameAction | null> {
    if (!this.hubUrl) {
      log.error("verify_no_hub", {});
      return null;
    }
    const messageBytes = body.trustedData?.messageBytes;
    if (typeof messageBytes !== "string" || messageBytes.length === 0) return null;

    let payload: unknown;
    try {
      const bytes = base64ToBytes(messageBytes) ?? hexToBytes(messageBytes);
      if (!bytes) return null;
      const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
      if (this.hubAuth) {
        headers.Authorization = `Bearer ${this.hubAuth}`;
        headers.api_key = this.hubAuth;
      }
      const res = await fetch(`${this.hubUrl}/v1/validateMessage`, {
        method: "POST",
        headers,
        body: bytes,
      });
      if (!res.ok) {
        log.warn("verify_hub_status", { status: res.status });
        return null;
      }
      payload = await res.json();
    } catch (err) {
      log.warn("verify_hub_error", { message: err instanceof Error ? err.message : String(err) });
      return null;
    }

    return mapValidatedMessage(payload);
  }
}

/** Decode a `0x`-prefixed or bare hex string to bytes, or `null`. */
function hexToBytes(value: string): Uint8Array | null {
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Map a hub `validateMessage` response to a verified action. Exported for unit tests. */
export function mapValidatedMessage(payload: unknown): VerifiedFrameAction | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as {
    valid?: unknown;
    message?: { data?: { fid?: unknown; frameActionBody?: Record<string, unknown> } };
  };
  if (p.valid !== true) return null;

  const data = p.message?.data;
  const fid = typeof data?.fid === "number" ? data.fid : Number.NaN;
  if (!Number.isInteger(fid) || fid <= 0) return null;

  const fab = data?.frameActionBody ?? {};
  const buttonIndexRaw = fab.buttonIndex;
  const buttonIndex = typeof buttonIndexRaw === "number" ? buttonIndexRaw : 1;

  return {
    fid,
    buttonIndex,
    inputText: bytesFieldToText(fab.inputText),
    state: bytesFieldToText(fab.state),
    address: asAddress(bytesFieldToHex(fab.address)),
    transactionId: bytesFieldToHex(fab.transactionId) || undefined,
  };
}
