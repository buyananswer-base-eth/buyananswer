// SPDX-License-Identifier: MIT
// Frame-signature verification: the pure hub-response mapper (`mapValidatedMessage`) across the two
// common hub JSON shapes, and the HubFrameVerifier's FAIL-CLOSED behaviour (no hub / non-200 / invalid
// → null). Live hub validation is a manual/debugger step (like the indexer's live RPC) — here the
// network is stubbed, so these tests never call a real Farcaster hub.

import { afterEach, describe, expect, it, vi } from "vitest";
import { HubFrameVerifier, mapValidatedMessage } from "../src/frame/verify.js";
import { framePostBody } from "./helpers.js";

afterEach(() => vi.unstubAllGlobals());

/** base64 of a byte array (what raw hubble renders protobuf `bytes` fields as). */
function b64(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes));
}
const b64text = (s: string) => btoa(s);

describe("mapValidatedMessage", () => {
  it("maps a raw-hubble response (base64 bytes fields)", () => {
    const addr = new Array(20).fill(0x11);
    const action = mapValidatedMessage({
      valid: true,
      message: {
        data: {
          fid: 99,
          frameActionBody: {
            buttonIndex: 1,
            inputText: b64text("why is the sky blue?"),
            state: b64text("state-blob"),
            address: b64(addr),
            transactionId: b64([0xab, 0xcd]),
          },
        },
      },
    });
    expect(action).not.toBeNull();
    expect(action?.fid).toBe(99);
    expect(action?.inputText).toBe("why is the sky blue?");
    expect(action?.state).toBe("state-blob");
    expect(action?.address).toBe("0x1111111111111111111111111111111111111111");
    expect(action?.transactionId).toBe("0xabcd");
  });

  it("maps a pre-decoded gateway response (literal strings / 0x hex)", () => {
    const action = mapValidatedMessage({
      valid: true,
      message: {
        data: {
          fid: 7,
          frameActionBody: {
            buttonIndex: 2,
            inputText: "hello",
            address: "0x2222222222222222222222222222222222222222",
          },
        },
      },
    });
    expect(action?.fid).toBe(7);
    expect(action?.buttonIndex).toBe(2);
    expect(action?.inputText).toBe("hello");
    expect(action?.address).toBe("0x2222222222222222222222222222222222222222");
    expect(action?.transactionId).toBeUndefined();
  });

  it("rejects an invalid message (valid !== true)", () => {
    expect(mapValidatedMessage({ valid: false })).toBeNull();
    expect(mapValidatedMessage({})).toBeNull();
    expect(mapValidatedMessage(null)).toBeNull();
  });

  it("rejects a message with no/invalid fid", () => {
    expect(mapValidatedMessage({ valid: true, message: { data: {} } })).toBeNull();
    expect(
      mapValidatedMessage({ valid: true, message: { data: { fid: 0, frameActionBody: {} } } }),
    ).toBeNull();
  });
});

describe("HubFrameVerifier (fail-closed)", () => {
  it("returns null when no hub is configured", async () => {
    const verifier = new HubFrameVerifier(undefined);
    expect(await verifier.verify(framePostBody())).toBeNull();
  });

  it("returns null on a non-200 hub response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    const verifier = new HubFrameVerifier("https://hub.example");
    expect(await verifier.verify(framePostBody())).toBeNull();
  });

  it("returns null on a transport error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    const verifier = new HubFrameVerifier("https://hub.example");
    expect(await verifier.verify(framePostBody())).toBeNull();
  });

  it("maps a valid hub response through fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              valid: true,
              message: { data: { fid: 5, frameActionBody: { buttonIndex: 1, inputText: "hi" } } },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    const verifier = new HubFrameVerifier("https://hub.example");
    const action = await verifier.verify(framePostBody());
    expect(action?.fid).toBe(5);
    expect(action?.inputText).toBe("hi");
  });
});
