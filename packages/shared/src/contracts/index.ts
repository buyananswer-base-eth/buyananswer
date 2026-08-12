// SPDX-License-Identifier: MIT
// Single source of truth for binding to the BuyAnAnswerEscrow contract: the compiled ABI
// (generated from contracts/out) plus per-chain address/startBlock metadata. Consumed by
// workers/*, packages/sdk, and apps/web.

export { buyAnAnswerEscrowAbi } from "./escrowAbi.js";
export {
  type Address,
  type EscrowDeployment,
  type SupportedChainId,
  BASE_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_USDC,
  BASE_USDC,
  escrowDeployments,
  getEscrowDeployment,
  requireEscrowAddress,
} from "./deployments.js";
