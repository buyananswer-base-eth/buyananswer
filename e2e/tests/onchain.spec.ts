// SPDX-License-Identifier: MIT
// The GATED on-chain integration: a REAL Base Sepolia `askQuestion` → the indexer reconciles it → the
// API reflects the money-state (`pending_payment` → `open`). This automates the seam Sessions 11–13
// could only verify by hand. It needs funds + secrets, so it runs ONLY when E2E_ONCHAIN=1 and the
// wallet/RPC/reconcile env is set (see e2e/.env.example) — otherwise it skips cleanly. Nightly / manual.
//
// It drives the API over HTTP (SIWE cookie auth, exactly like a browser) and the chain with viem. The
// escrow/USDC addresses come from env (no literals here); the ABI + the uuid→bytes32 ref codec are the
// minimal inline mirror of @buyananswer/shared (this standalone package can't import the workspace).
// If the real ABI/codec ever drift, THIS test fails against the deployed contract — which is the point.

import { type APIRequestContext, expect, test } from "@playwright/test";
import {
  http,
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  defineChain,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

const onchain = process.env.E2E_ONCHAIN === "1";
const RPC_URL = process.env.E2E_RPC_URL ?? "";
const ASKER_PK = (process.env.E2E_WALLET_PK ?? "") as Hex;
const RECONCILE_TOKEN = process.env.E2E_RECONCILE_TOKEN ?? "";
const API_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:8787";
const INDEXER_URL = process.env.E2E_INDEXER_URL ?? "http://127.0.0.1:8788";
const ESCROW = (process.env.E2E_ESCROW ?? "0x40A4bfEc9441752BcABBd4b3939503671c8724dB") as Address;
const USDC = (process.env.E2E_USDC ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as Address;
const CHAIN_ID = 84532;
const AMOUNT = 10_000n; // 0.01 USDC (6-dp) — keep the testnet cost tiny

// A second, UNFUNDED key plays the creator (claiming a handle is just a signature). Anvil account #3.
const CREATOR_PK = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex;

// Minimal inline mirror of @buyananswer/shared (uuidToRef) + the escrow/USDC ABIs used here.
const escrowAbi = parseAbi([
  "function askQuestion(bytes32 ref, address answerer, uint128 amount) returns (uint256)",
]);
const usdcAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
]);
const uuidToRef = (uuid: string): Hex => `0x${uuid.replace(/-/g, "").padStart(64, "0")}`;

/** SIWE login against the API for `account`, returning a cookie-scoped request context. */
async function login(ctx: APIRequestContext, account: ReturnType<typeof privateKeyToAccount>) {
  const host = new URL(API_URL).host;
  const nonceRes = await ctx.post(`${API_URL}/auth/nonce`);
  expect(nonceRes.ok()).toBeTruthy();
  const { nonce } = (await nonceRes.json()) as { nonce: string };
  const message = createSiweMessage({
    address: account.address,
    chainId: CHAIN_ID,
    domain: host,
    nonce,
    uri: `${API_URL}/login`,
    version: "1",
    statement: "Sign in to BuyAnAnswer",
  });
  const signature = await account.signMessage({ message });
  const verify = await ctx.post(`${API_URL}/auth/verify`, { data: { message, signature } });
  expect(verify.ok()).toBeTruthy();
}

test.describe("on-chain: askQuestion → indexer → API `open` (gated)", () => {
  test.skip(
    !onchain || !RPC_URL || !ASKER_PK || !RECONCILE_TOKEN,
    "set E2E_ONCHAIN=1 with a funded wallet + RPC + reconcile token to run the on-chain journey",
  );

  test("a real escrow ask reconciles to `open` in the API", async ({ playwright }) => {
    test.setTimeout(180_000);
    const asker = privateKeyToAccount(ASKER_PK);
    const creator = privateKeyToAccount(CREATOR_PK);

    const publicClient = createPublicClient({ transport: http(RPC_URL) });
    const chain = defineChain({
      id: CHAIN_ID,
      name: "base-sepolia-e2e",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [RPC_URL] } },
    });
    const walletClient = createWalletClient({ account: asker, chain, transport: http(RPC_URL) });

    // Sanity: the asker must actually hold enough testnet USDC to escrow.
    const balance = await publicClient.readContract({
      address: USDC,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [asker.address],
    });
    expect(balance, "asker needs testnet USDC — fund E2E_WALLET_PK").toBeGreaterThanOrEqual(AMOUNT);

    // 1. Creator claims a handle (signature only, no funds), so there's a real answerer to ask.
    const creatorCtx = await playwright.request.newContext();
    await login(creatorCtx, creator);
    const handle = `e2e_${Date.now().toString(36)}`.slice(0, 30);
    const claim = await creatorCtx.post(`${API_URL}/handle/claim`, {
      data: { handle, minPriceUsdc: AMOUNT.toString() },
    });
    expect(claim.ok()).toBeTruthy();

    // 2. Asker signs in and mints the off-chain draft (chain-first: the row exists before paying).
    const askerCtx = await playwright.request.newContext();
    await login(askerCtx, asker);
    const created = await askerCtx.post(`${API_URL}/questions`, {
      data: { handle, amountUsdc: AMOUNT.toString(), body: "e2e on-chain ask → open" },
    });
    expect(created.ok()).toBeTruthy();
    const { id } = (await created.json()) as { id: string };

    // 3. Pay on-chain: approve (if needed) then askQuestion with the minted UUID as the bytes32 ref.
    const allowance = await publicClient.readContract({
      address: USDC,
      abi: usdcAbi,
      functionName: "allowance",
      args: [asker.address, ESCROW],
    });
    if (allowance < AMOUNT) {
      const approveHash = await walletClient.writeContract({
        address: USDC,
        abi: usdcAbi,
        functionName: "approve",
        args: [ESCROW, AMOUNT],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
    }
    const askHash = await walletClient.writeContract({
      address: ESCROW,
      abi: escrowAbi,
      functionName: "askQuestion",
      args: [uuidToRef(id), creator.address, AMOUNT],
    });
    await publicClient.waitForTransactionReceipt({ hash: askHash, confirmations: 1 });

    // 4. The API still shows pending_payment until the indexer sees the event. Nudge a reconcile pass
    //    (patiently — the indexer waits CONFIRMATIONS blocks before finalizing) and poll for `open`.
    await expect(async () => {
      const nudge = await askerCtx.post(`${INDEXER_URL}/reconcile`, {
        headers: { authorization: `Bearer ${RECONCILE_TOKEN}` },
      });
      expect(nudge.ok()).toBeTruthy();
      const detail = await askerCtx.get(`${API_URL}/questions/${id}`);
      const { question } = (await detail.json()) as { question: { status: string } };
      expect(question.status).toBe("open");
    }).toPass({ timeout: 150_000, intervals: [5_000] });

    await creatorCtx.dispose();
    await askerCtx.dispose();
  });
});
