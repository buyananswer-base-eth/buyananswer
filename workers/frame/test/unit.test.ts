// SPDX-License-Identifier: MIT
// Pure-unit coverage of the frame primitives: the state codec (thread the question id across steps),
// the meta renderer (escaping + tx-button post_url wiring), the config resolver (CAIP-2 + no address
// literals), the tx builders (calldata identical to the SDK), and the USDC display formatter.

import { encodeApprove, encodeAskQuestion, refForQuestion } from "@buyananswer/sdk";
import { requireEscrowAddress } from "@buyananswer/shared";
import { describe, expect, it } from "vitest";
import { copy, formatUsdc } from "../src/copy.js";
import type { Env } from "../src/env.js";
import { resolveConfig } from "../src/env.js";
import { renderFrame } from "../src/frame/meta.js";
import { decodeState, encodeState } from "../src/frame/state.js";
import { buildApproveTx, buildAskTx } from "../src/frame/tx.js";

const baseEnv: Env = {
  DB: {} as D1Database,
  RATELIMIT: {} as KVNamespace,
  CHAIN_ID: "84532",
  APP_ORIGIN: "https://app.buyananswer.com/",
  FRAME_IMAGE_BASE: "https://cdn.example/",
  FRAME_HUB_URL: "https://hub.example/",
};

describe("state codec", () => {
  it("round-trips a question id", () => {
    const qid = crypto.randomUUID();
    expect(decodeState(encodeState({ qid }))).toEqual({ qid });
  });

  it("returns null for missing/garbage state", () => {
    expect(decodeState(undefined)).toBeNull();
    expect(decodeState("")).toBeNull();
    expect(decodeState("not-base64-json!!")).toBeNull();
    expect(decodeState(btoa(JSON.stringify({ nope: 1 })))).toBeNull();
  });
});

describe("resolveConfig", () => {
  it("derives CAIP-2 + escrow/usdc from the shared deployment (no literals)", () => {
    const config = resolveConfig(baseEnv);
    expect(config.chainId).toBe(84532);
    expect(config.caip2).toBe("eip155:84532");
    expect(config.escrow).toBe(requireEscrowAddress(84532));
    expect(config.appOrigin).toBe("https://app.buyananswer.com"); // trailing slash stripped
    expect(config.imageBase).toBe("https://cdn.example");
    expect(config.hubUrl).toBe("https://hub.example");
  });

  it("throws for a chain with no deployed escrow", () => {
    expect(() => resolveConfig({ ...baseEnv, CHAIN_ID: "1" })).toThrow();
  });

  it("defaults imageBase to appOrigin when unset", () => {
    const { FRAME_IMAGE_BASE: _omitted, ...envNoImage } = baseEnv;
    const config = resolveConfig(envNoImage);
    expect(config.imageBase).toBe("https://app.buyananswer.com");
  });
});

describe("renderFrame", () => {
  it("emits a tx button with a per-button post_url and escapes attributes", () => {
    const html = renderFrame({
      title: 'Ask "Bob" <script>',
      image: "https://cdn/x.png",
      input: "Ask…",
      state: "st",
      buttons: [
        {
          label: "Pay",
          action: "tx",
          target: "https://f/tx",
          postUrl: "https://f/after",
        },
        { label: "Web", action: "link", target: "https://web" },
      ],
    });
    expect(html).toContain('content="vNext"');
    expect(html).toContain('property="fc:frame:button:1:action" content="tx"');
    expect(html).toContain('property="fc:frame:button:1:post_url" content="https://f/after"');
    // A link button must NOT carry a post_url.
    expect(html).not.toContain('property="fc:frame:button:2:post_url"');
    // Attribute escaping (no raw quotes/brackets from the title leak in).
    expect(html).toContain("&quot;Bob&quot;");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("tx builders match the SDK", () => {
  it("approve targets USDC with encodeApprove calldata", () => {
    const config = resolveConfig(baseEnv);
    const tx = buildApproveTx(config, 2_000_000n);
    expect(tx.chainId).toBe("eip155:84532");
    expect(tx.params.to).toBe(config.usdc);
    expect(tx.params.data).toBe(encodeApprove(config.escrow, 2_000_000n));
    expect(tx.params.value).toBe("0");
  });

  it("askQuestion targets the escrow with encodeAskQuestion calldata", () => {
    const config = resolveConfig(baseEnv);
    const qid = crypto.randomUUID();
    const tx = buildAskTx(config, { questionId: qid, answerer: config.usdc, amount: 3_000_000n });
    expect(tx.params.to).toBe(config.escrow);
    expect(tx.params.data).toBe(
      encodeAskQuestion({ ref: refForQuestion(qid), answerer: config.usdc, amount: 3_000_000n }),
    );
  });
});

describe("formatUsdc", () => {
  it("formats base units to a compact decimal", () => {
    expect(formatUsdc(2_000_000n)).toBe("2");
    expect(formatUsdc(2_500_000n)).toBe("2.5");
    expect(formatUsdc(1n)).toBe("0.000001");
    expect(formatUsdc(10_500_000n)).toBe("10.5");
  });

  it("exposes plain-language copy (no 'escrow' jargon)", () => {
    const all = Object.values(copy)
      .map((v) => (typeof v === "function" ? v("x") : v))
      .join(" ")
      .toLowerCase();
    expect(all).not.toContain("escrow");
  });
});
