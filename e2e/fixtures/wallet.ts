// SPDX-License-Identifier: MIT
// A headless EIP-1193 wallet for Playwright. The private key lives ONLY in Node: the browser page gets
// a thin `window.ethereum` provider whose every call is proxied to Node via an exposed function. Node
// answers accounts/chainId/sign locally, sends transactions with a viem wallet client, and forwards
// any other JSON-RPC read straight to the configured RPC. It's announced over EIP-6963 (and left on
// `window.ethereum`) so wagmi's connectors discover it.
//
// SIWE (the onboard journey) needs only sign + accounts — NO RPC and NO funds. Transactions (the gated
// on-chain journey) need `rpcUrl` + a funded key.

import type { BrowserContext } from "@playwright/test";
import { http, type Chain, createWalletClient, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface HeadlessWalletOptions {
  privateKey: `0x${string}`;
  chainId: number;
  /** A JSON-RPC endpoint. Required only for the on-chain (transaction) journey. */
  rpcUrl?: string;
  /**
   * Whether this wallet can sign EIP-712 typed data. Defaults to true. Set false to model a wallet with
   * no `eth_signTypedData_v4` (some hardware/smart-account wallets): the ask flow's EIP-2612 permit
   * becomes unusable and it falls back to the explicit **approve + askQuestion** path (ADR-0027). That
   * fallback is otherwise unreachable in a test, since the permit succeeds whenever it can be signed.
   */
  signTypedData?: boolean;
  /**
   * Called in Node for every transaction this wallet actually sends. Lets a test observe WHICH on-chain
   * path the UI chose (e.g. an approve to USDC then an ask to the escrow = the approve fallback; a
   * single ask = the permit path) and collect hashes, without reaching into the app.
   */
  onTransaction?: (tx: { to: `0x${string}`; data?: `0x${string}`; hash: `0x${string}` }) => void;
}

type RpcCall = { method: string; params?: unknown[] };

/** Forward an arbitrary JSON-RPC read to the RPC endpoint (used for eth_call, receipts, blocks, …). */
async function forward(rpcUrl: string, { method, params = [] }: RpcCall): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(`${method} failed: ${json.error.message}`);
  return json.result;
}

/**
 * Install the headless wallet on a Playwright browser context. Returns the wallet address. Call before
 * the first `page.goto` so the injected provider is present on load.
 */
export async function installHeadlessWallet(
  context: BrowserContext,
  opts: HeadlessWalletOptions,
): Promise<`0x${string}`> {
  const account = privateKeyToAccount(opts.privateKey);
  const chainIdHex = `0x${opts.chainId.toString(16)}`;

  const wallet = opts.rpcUrl
    ? createWalletClient({
        account,
        chain: defineChain({
          id: opts.chainId,
          name: `e2e-${opts.chainId}`,
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: [opts.rpcUrl] } },
        }) as Chain,
        transport: http(opts.rpcUrl),
      })
    : undefined;

  await context.exposeFunction("__e2eRpc", async ({ method, params = [] }: RpcCall) => {
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [account.address];
      case "eth_chainId":
        return chainIdHex;
      case "net_version":
        return String(opts.chainId);
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain":
        return null;
      case "wallet_requestPermissions":
        return [{ parentCapability: "eth_accounts" }];
      case "wallet_getPermissions":
        return [{ parentCapability: "eth_accounts" }];
      // SIWE: sign the exact bytes the connector hands us (hex of the SIWE string) with the personal_sign
      // prefix, so it recovers against the message the API validates.
      case "personal_sign":
        return account.signMessage({ message: { raw: params[0] as `0x${string}` } });
      case "eth_signTypedData_v4":
        if (opts.signTypedData === false) {
          // Not a user rejection — the app must read this as "this wallet can't permit" and fall back.
          throw new Error("this wallet does not support eth_signTypedData_v4");
        }
        return account.signTypedData(JSON.parse(params[1] as string));
      case "eth_sendTransaction": {
        if (!wallet)
          throw new Error("eth_sendTransaction needs a headless wallet RPC (set E2E_RPC_URL)");
        const tx = params[0] as { to: `0x${string}`; data?: `0x${string}`; value?: `0x${string}` };
        const hash = await wallet.sendTransaction({
          to: tx.to,
          data: tx.data,
          value: tx.value ? BigInt(tx.value) : undefined,
        });
        opts.onTransaction?.({ to: tx.to, data: tx.data, hash });
        return hash;
      }
      default: {
        if (!opts.rpcUrl) throw new Error(`headless wallet: unsupported method ${method} (no RPC)`);
        return forward(opts.rpcUrl, { method, params });
      }
    }
  });

  await context.addInitScript(
    (args: { address: string }) => {
      const listeners: Record<string, Array<(x: unknown) => void>> = {};
      const rpc = (window as unknown as { __e2eRpc: (c: RpcCall) => Promise<unknown> }).__e2eRpc;
      const provider = {
        isMetaMask: true,
        isE2EWallet: true,
        request: (payload: { method: string; params?: unknown[] }) =>
          rpc({ method: payload.method, params: payload.params ?? [] }),
        on(event: string, fn: (x: unknown) => void) {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(fn);
          return provider;
        },
        removeListener(event: string, fn: (x: unknown) => void) {
          listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn);
          return provider;
        },
      };
      (window as unknown as { ethereum: unknown }).ethereum = provider;

      const detail = Object.freeze({
        info: {
          uuid: "8f9a1c2b-3d4e-4f50-9a1b-2c3d4e5f6a7b",
          name: "E2E Wallet",
          icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
          rdns: "com.buyananswer.e2e",
        },
        provider,
      });
      const announce = () =>
        window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
      window.addEventListener("eip6963:requestProvider", announce as EventListener);
      announce();
      void args.address;
    },
    { address: account.address },
  );

  return account.address;
}
