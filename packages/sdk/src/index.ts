// SPDX-License-Identifier: MIT
// @buyananswer/sdk — the framework-agnostic (viem) on-chain SDK for BuyAnAnswer. It builds the escrow
// ask transactions and the EIP-2612 USDC permit signature, so the web app and the Farcaster frame share
// one tx-construction implementation. It builds calldata/typed-data and reads/signing are done by the
// caller's client — the SDK never holds a wallet, RPC, or private key.

export * from "./erc20.js";
export * from "./permit.js";
export * from "./escrow.js";
export * from "./settle.js";
