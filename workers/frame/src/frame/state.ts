// SPDX-License-Identifier: MIT
// Frame `state` codec. Farcaster echoes a frame's `fc:frame:state` back on every subsequent action
// POST (and it is covered by the message signature), so it's how we thread our own context across the
// two-transaction ask flow: the minted question id (`qid`) set on the "confirm" frame is echoed to the
// tx endpoint and the final callback. A transaction endpoint response CANNOT set new state, which is
// exactly why the qid is minted in the HTML "confirm" frame (approve callback), not inside a tx
// response (ADR-0031).
//
// The state ALSO carries the minting asker (`asker`) so the paying `tx-ask` can bind the ref to the
// wallet that minted it (ADR-0032). NB: a signed state is not by itself proof of ownership — a crafted
// client can sign its OWN message carrying an arbitrary qid — so `tx-ask` cross-checks the stored row's
// asker against the verified connected wallet. `asker` here is a cheap first gate + a self-documenting
// binding; the DB check in app.ts is the authoritative one.

/** Our frame state payload — the off-chain question id being paid for, + the minting asker wallet. */
export interface FrameState {
  qid: string;
  /** Lowercase `0x` wallet that minted `qid` (the verified asker at approve time), when known. */
  asker?: string;
}

/** UUIDs are 36 chars; cap well above that so a pathological state can't bloat a downstream query/log. */
const MAX_QID_LEN = 64;

/** Encode state as base64url JSON for `fc:frame:state`. */
export function encodeState(state: FrameState): string {
  const json = JSON.stringify(state);
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode `fc:frame:state`; returns `null` on anything malformed or out-of-bounds (fail-safe). */
export function decodeState(value: string | undefined): FrameState | null {
  if (!value) return null;
  try {
    const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(atob(b64)) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as FrameState).qid === "string" &&
      (parsed as FrameState).qid.length > 0 &&
      (parsed as FrameState).qid.length <= MAX_QID_LEN
    ) {
      const p = parsed as FrameState;
      const asker =
        typeof p.asker === "string" && /^0x[0-9a-f]{40}$/.test(p.asker) ? p.asker : undefined;
      return asker ? { qid: p.qid, asker } : { qid: p.qid };
    }
  } catch {
    /* fall through */
  }
  return null;
}
