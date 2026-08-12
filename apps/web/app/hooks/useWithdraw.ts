// SPDX-License-Identifier: MIT
// The `withdraw()` money state machine. Settling (answer/decline/cancel/reclaim) is pull-payment: it only
// *credits* `withdrawable[account]` inside the escrow. Funds reach a wallet solely via `withdraw()`, which
// sweeps the caller's entire credit. Unlike a settle, there is no off-chain money-state to poll for — the
// balance is a pure on-chain read — so this flow ends at the confirmed receipt; the caller re-reads
// `withdrawable(address)` (chain = source of truth) via `onConfirmed` to reflect the new zero balance.

import { buyAnAnswerEscrowAbi, withdrawArgs } from "@buyananswer/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { canAskOn, escrowAddressFor } from "../lib/chains";
import { isUserRejection, mapSettleError } from "../lib/txerror";

export type WithdrawPhase =
  | { step: "idle" }
  | { step: "confirming" } // simulating + awaiting the wallet confirmation
  | { step: "pending"; hash: Hex } // tx submitted, waiting for the receipt
  | { step: "success"; hash: Hex }
  | { step: "rejected"; message: string }
  | { step: "error"; message: string };

export interface UseWithdraw {
  phase: WithdrawPhase;
  withdraw: () => void;
  reset: () => void;
  busy: boolean;
}

const BUSY_STEPS: ReadonlySet<WithdrawPhase["step"]> = new Set(["confirming", "pending"]);

/** @param onConfirmed run after a successful withdraw (re-read the on-chain `withdrawable` balance). */
export function useWithdraw(onConfirmed?: () => void): UseWithdraw {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [phase, setPhaseState] = useState<WithdrawPhase>({ step: "idle" });

  const runTokenRef = useRef(0);
  const mountedRef = useRef(true);
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runTokenRef.current += 1;
    };
  }, []);

  const setPhase = useCallback((token: number, next: WithdrawPhase) => {
    if (token === runTokenRef.current && mountedRef.current) setPhaseState(next);
  }, []);

  const withdraw = useCallback(() => {
    runTokenRef.current += 1;
    const token = runTokenRef.current;

    if (!address) {
      setPhase(token, { step: "error", message: "Connect your wallet to withdraw." });
      return;
    }
    if (!canAskOn(chainId)) {
      setPhase(token, { step: "error", message: "Switch to Base Sepolia to withdraw." });
      return;
    }
    const escrow = escrowAddressFor(chainId);
    if (!escrow || !publicClient) {
      setPhase(token, { step: "error", message: "This network isn't set up for payments." });
      return;
    }
    const client = publicClient;

    void (async () => {
      try {
        setPhase(token, { step: "confirming" });
        // Simulate first: `withdraw()` reverts `NothingToWithdraw` on a zero balance — surface that
        // (decoded) before the wallet prompt rather than as an opaque failed tx.
        await client.simulateContract({
          address: escrow,
          abi: buyAnAnswerEscrowAbi,
          functionName: "withdraw",
          args: withdrawArgs(),
          account: address,
        });
        const hash = await writeContractAsync({
          address: escrow,
          abi: buyAnAnswerEscrowAbi,
          functionName: "withdraw",
          args: withdrawArgs(),
        });
        if (token !== runTokenRef.current) return;
        setPhase(token, { step: "pending", hash });
        const receipt = await client.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("The transaction reverted on-chain.");
        if (token !== runTokenRef.current) return;
        setPhase(token, { step: "success", hash });
        onConfirmedRef.current?.();
      } catch (e) {
        if (token !== runTokenRef.current) return;
        if (isUserRejection(e)) {
          setPhase(token, {
            step: "rejected",
            message: "You cancelled the request in your wallet.",
          });
          return;
        }
        setPhase(token, { step: "error", message: mapSettleError(e) });
      }
    })();
  }, [address, chainId, publicClient, setPhase, writeContractAsync]);

  const reset = useCallback(() => {
    runTokenRef.current += 1;
    setPhaseState({ step: "idle" });
  }, []);

  return { phase, withdraw, reset, busy: BUSY_STEPS.has(phase.step) };
}
