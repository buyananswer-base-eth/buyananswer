// SPDX-License-Identifier: MIT
// The settle money state machine — the answer/decline/cancel/reclaim half of the lifecycle (Session 12),
// built on the SAME chain-first contract as useAskAndPay: send the escrow tx → wait for the receipt →
// poll `GET /questions/:id` until the *indexer* flips the status to a terminal state → confirmed. The
// client NEVER writes money-state; chain is the source of truth. Each settle call takes the on-chain
// `uint256` id (`questions.onchain_id`), not the UUID — the UUID is only for polling.
//
// `answer` additionally runs a `preflight` (save the hidden draft) BEFORE the tx: the indexer marks a
// question `answered` from chain truth even with no body, and the answer route then 409s, so the draft
// must exist first (Session-8 edge note).

import { type SettleFunction, buyAnAnswerEscrowAbi, settleArgs } from "@buyananswer/sdk";
import type { QuestionStatus } from "@buyananswer/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { type AnalyticsEvent, track } from "../lib/analytics";
import { getQuestion, postReconcileNudge } from "../lib/api";
import { canAskOn, escrowAddressFor } from "../lib/chains";
import { isTerminalStatus } from "../lib/status";
import { isUserRejection, mapSettleError } from "../lib/txerror";

/** Poll cadence + how many polls before we show the "taking longer than usual" hint (~24s). */
// Tightened alongside the indexer nudge below. The chain is final in ~12s (2s block + 5
// confirmations); polling every 4s meant up to 4s of that was pure client-side dead time.
const POLL_INTERVAL_MS = 1_500;
const SLOW_AFTER_POLLS = 16;

/** The four settle actions this hook drives. */
export type SettleKind = "answer" | "decline" | "cancel" | "reclaim";

interface KindMeta {
  functionName: SettleFunction;
  event: AnalyticsEvent;
}

const KIND_META: Record<SettleKind, KindMeta> = {
  answer: { functionName: "answerQuestion", event: "question_answered" },
  decline: { functionName: "declineQuestion", event: "question_declined" },
  cancel: { functionName: "cancelQuestion", event: "question_cancelled" },
  reclaim: { functionName: "reclaimQuestion", event: "question_reclaimed" },
};

/** The discriminated state of a settle action — every branch is a distinct UI (§10 money states). */
export type SettlePhase =
  | { step: "idle" }
  | { step: "preparing" } // running the optional preflight (answer: save the hidden draft)
  | { step: "confirming" } // simulating + awaiting the wallet confirmation
  | { step: "pending"; hash: Hex } // tx submitted, waiting for the receipt
  | { step: "indexing"; hash: Hex; slow: boolean } // waiting for the indexer to write the new status
  | { step: "confirmed"; hash: Hex; status: QuestionStatus }
  | { step: "rejected"; message: string } // user declined in the wallet
  | { step: "error"; message: string }; // preflight / on-chain / network failure

export interface SettleRunInput {
  /** The question UUID (`questions.id`) — used only to poll the API for the indexed status. */
  questionId: string;
  /** The on-chain id (`questions.onchain_id`) the settle tx takes — non-null only once indexed to open. */
  onchainId: bigint;
  /**
   * An optional step to run BEFORE the tx (answer: `POST /questions/:id/answer`). If it throws, the flow
   * fails with the thrown error's message (no tx is sent). It must reject with a user-facing `.message`.
   */
  preflight?: () => Promise<void>;
}

export interface UseSettleAction {
  phase: SettlePhase;
  /** Run the full flow (preflight → tx → confirm via the indexer). */
  run: (input: SettleRunInput) => void;
  /** Retry from the top with the last input (preflight is idempotent; the tx re-simulates first). */
  retry: () => void;
  /** Force an immediate indexer re-check while `indexing`. */
  recheck: () => void;
  /** Return to `idle`. */
  reset: () => void;
  /** True while the flow is mid-run (buttons/forms should be disabled). */
  busy: boolean;
}

const BUSY_STEPS: ReadonlySet<SettlePhase["step"]> = new Set([
  "preparing",
  "confirming",
  "pending",
  "indexing",
]);

export function useSettleAction(kind: SettleKind): UseSettleAction {
  const { functionName, event } = KIND_META[kind];
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [phase, setPhaseState] = useState<SettlePhase>({ step: "idle" });

  const runTokenRef = useRef(0);
  const mountedRef = useRef(true);
  const wakeRef = useRef<(() => void) | null>(null);
  const lastInputRef = useRef<SettleRunInput | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runTokenRef.current += 1; // cancel any in-flight loop
      wakeRef.current?.();
    };
  }, []);

  const setPhase = useCallback((token: number, next: SettlePhase) => {
    if (token === runTokenRef.current && mountedRef.current) setPhaseState(next);
  }, []);

  const interruptibleSleep = useCallback((ms: number) => {
    return new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        wakeRef.current = null;
        resolve();
      }, ms);
      wakeRef.current = () => {
        clearTimeout(t);
        wakeRef.current = null;
        resolve();
      };
    });
  }, []);

  // Poll until the indexer writes a terminal status. The tx already succeeded, so a transient read error
  // is not fatal — keep polling; the settlement is safely on-chain.
  const indexLoop = useCallback(
    async (token: number, questionId: string, hash: Hex) => {
      let attempts = 0;
      for (;;) {
        if (token !== runTokenRef.current) return;
        try {
          const { question } = await getQuestion(questionId);
          if (isTerminalStatus(question.status)) {
            track(event, { id: questionId, status: question.status });
            setPhase(token, { step: "confirmed", hash, status: question.status });
            return;
          }
        } catch {
          // transient — retry on the next tick
        }
        attempts += 1;
        setPhase(token, { step: "indexing", hash, slow: attempts >= SLOW_AFTER_POLLS });
        // Nudge the indexer to reconcile NOW instead of waiting for its cron. Fire-and-forget and
        // never throws. Repeated each tick on purpose: the indexer only scans to
        // `head - CONFIRMATIONS`, so a single nudge right after the receipt would scan past the
        // new event. Idempotent server-side, so repeats are safe.
        void postReconcileNudge();
        await interruptibleSleep(POLL_INTERVAL_MS);
      }
    },
    [event, setPhase, interruptibleSleep],
  );

  const execute = useCallback(
    async (token: number, input: SettleRunInput) => {
      if (!address) {
        setPhase(token, { step: "error", message: "Connect your wallet to continue." });
        return;
      }
      if (!canAskOn(chainId)) {
        setPhase(token, { step: "error", message: "Switch to Base Sepolia to continue." });
        return;
      }
      const escrow = escrowAddressFor(chainId);
      if (!escrow || !publicClient) {
        setPhase(token, { step: "error", message: "This network isn't set up for payments." });
        return;
      }
      const client = publicClient;

      // 1) Preflight (answer only): persist the hidden draft before the on-chain reveal.
      if (input.preflight) {
        setPhase(token, { step: "preparing" });
        try {
          await input.preflight();
        } catch (e) {
          if (token !== runTokenRef.current) return;
          const message = e instanceof Error ? e.message : "Couldn't save your answer. Try again.";
          setPhase(token, { step: "error", message });
          return;
        }
        if (token !== runTokenRef.current) return;
      }

      // 2) Simulate → send → wait for the receipt → hand off to the indexer poll.
      try {
        setPhase(token, { step: "confirming" });
        // Simulate first so a guard revert (NotOpen/NotAnswerer/DeadlinePassed/…) surfaces a decoded
        // reason BEFORE the wallet prompt, instead of an opaque failed tx.
        await client.simulateContract({
          address: escrow,
          abi: buyAnAnswerEscrowAbi,
          functionName,
          args: settleArgs(input.onchainId),
          account: address,
        });
        const hash = await writeContractAsync({
          address: escrow,
          abi: buyAnAnswerEscrowAbi,
          functionName,
          args: settleArgs(input.onchainId),
        });
        if (token !== runTokenRef.current) return;
        setPhase(token, { step: "pending", hash });
        const receipt = await client.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("The transaction reverted on-chain.");
        if (token !== runTokenRef.current) return;
        setPhase(token, { step: "indexing", hash, slow: false });
        await indexLoop(token, input.questionId, hash);
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
    },
    [address, chainId, publicClient, functionName, setPhase, writeContractAsync, indexLoop],
  );

  const run = useCallback(
    (input: SettleRunInput) => {
      lastInputRef.current = input;
      runTokenRef.current += 1;
      void execute(runTokenRef.current, input);
    },
    [execute],
  );

  const retry = useCallback(() => {
    const input = lastInputRef.current;
    if (!input) return;
    runTokenRef.current += 1;
    void execute(runTokenRef.current, input);
  }, [execute]);

  const recheck = useCallback(() => {
    wakeRef.current?.();
  }, []);

  const reset = useCallback(() => {
    runTokenRef.current += 1;
    wakeRef.current?.();
    lastInputRef.current = null;
    setPhaseState({ step: "idle" });
  }, []);

  return { phase, run, retry, recheck, reset, busy: BUSY_STEPS.has(phase.step) };
}
