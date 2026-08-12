// SPDX-License-Identifier: MIT
// The chain-read boundary. `ChainReader` is the only surface the reconcile core depends on, so tests
// inject a mock (no live RPC) and production uses `ViemChainReader`. The reader is read-only: the
// indexer never constructs or sends a transaction — it only reads logs + the head, then writes D1.

import { http, createPublicClient } from "viem";
import { base, baseSepolia } from "viem/chains";
import type { IndexerConfig } from "./env.js";
import { type EscrowEvent, type RawEscrowLog, escrowEventAbis, normalizeLog } from "./events.js";

/** The read surface the reconcile loop needs. Implemented by {@link ViemChainReader} + test fakes. */
export interface ChainReader {
  /** The latest block safe to finalize = head − confirmations (clamped at 0). */
  getFinalizedHead(): Promise<bigint>;
  /** Decoded escrow events in the inclusive block range `[fromBlock, toBlock]` (any order). */
  getLogs(fromBlock: bigint, toBlock: bigint): Promise<EscrowEvent[]>;
}

/** viem chains the indexer supports, by id. Only Base Sepolia is deployed today (ADR-0020). */
const CHAINS = { [baseSepolia.id]: baseSepolia, [base.id]: base } as const;

/** Build the public client. Its inferred type is captured via ReturnType so the OP-stack chain's
 * block/tx formatters don't collide with viem's bare `PublicClient` type. */
function createEscrowClient(config: IndexerConfig) {
  const chain = CHAINS[config.chainId as keyof typeof CHAINS];
  if (!chain) throw new Error(`unsupported chain id ${config.chainId}`);
  // Undefined rpcUrl ⇒ viem uses the chain's default public endpoint.
  return createPublicClient({ chain, transport: http(config.rpcUrl) });
}

/** A viem-backed {@link ChainReader} over a single escrow deployment. */
export class ViemChainReader implements ChainReader {
  private readonly client: ReturnType<typeof createEscrowClient>;

  constructor(private readonly config: IndexerConfig) {
    this.client = createEscrowClient(config);
  }

  async getFinalizedHead(): Promise<bigint> {
    const head = await this.client.getBlockNumber();
    const confirmations = BigInt(this.config.confirmations);
    return head > confirmations ? head - confirmations : 0n;
  }

  async getLogs(fromBlock: bigint, toBlock: bigint): Promise<EscrowEvent[]> {
    const logs = await this.client.getLogs({
      address: this.config.contractAddress,
      events: escrowEventAbis,
      fromBlock,
      toBlock,
    });
    const events: EscrowEvent[] = [];
    for (const raw of logs) {
      const event = normalizeLog(raw as RawEscrowLog);
      if (event) events.push(event);
    }
    return events;
  }
}
