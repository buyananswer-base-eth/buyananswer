// SPDX-License-Identifier: MIT
// The ask + pay money state machine (FUNCTIONAL_SPEC §5, §10; session brief "chain-first ordering").
//
// The NORMATIVE ordering is: (1) `POST /questions` mints the UUID and passes the min-price gate; (2) send
// the escrow `askQuestion` tx with that UUID encoded as the `bytes32 ref`; (3) DO NOT mark the question
// paid from the client — poll `GET /questions/:id` until the *indexer* flips `status` to `open`. Chain is
// the source of truth for money; the client never writes money-state.
//
// USDC is provided via EIP-2612 `askQuestionWithPermit` (single signature) when an allowance is needed,
// with an **approve + askQuestion** fallback for wallets/tokens where the permit is unusable — decided by
// simulating the permit call and falling back if it would revert (the contract's permit is front-run-safe
// try/catch, but a bad domain + zero allowance would still revert the whole ask, so we simulate first).
// That fallback's tail lives in `lib/allowance.ts`: an approve is only trusted once its receipt says
// `success` AND a chain read shows the allowance, because the RPC is read-after-write inconsistent.
//
// Every amount is a base-unit `bigint` — never a JS number, never a float.

import {
  type AskParams,
  askQuestionArgs,
  askQuestionWithPermitArgs,
  buildUsdcPermitTypedData,
  buyAnAnswerEscrowAbi,
  refForQuestion,
  splitPermitSignature,
  usdcAbi,
} from "@buyananswer/sdk";
import type { Address, QuestionStatus } from "@buyananswer/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { useAccount, usePublicClient, useSignTypedData, useWriteContract } from "wagmi";
import { confirmApproval } from "../lib/allowance";
import { track } from "../lib/analytics";
import { ApiError, NetworkError, getQuestion, postQuestion } from "../lib/api";
import { canAskOn, escrowAddressFor, usdcAddressFor } from "../lib/chains";
import { isUserRejection, txErrorMessage } from "../lib/txerror";

/** Permit signatures are short-lived — they only need to outlive the single ask transaction. */
const PERMIT_TTL_SECONDS = 30 * 60;
/** Poll cadence + how many polls before we show the "taking longer than usual" hint (~30s). */
const POLL_INTERVAL_MS = 4_000;
const SLOW_AFTER_POLLS = 6;

/** What the caller supplies to ask a question. `amount` is USDC base units (≥ the creator's min). */
export interface AskInput {
  handle: string;
  body: string;
  amount: bigint;
  answerer: Address;
}

/** The discriminated state of the ask + pay flow. Every branch is a distinct UI (§10 money states). */
export type AskPhase =
  | { step: "idle" }
  | { step: "creating" } // POST /questions (mint UUID + min-price gate)
  | { step: "checking" } // reading USDC balance + allowance
  | { step: "insufficient"; balance: bigint; needed: bigint }
  | { step: "permitting" } // awaiting the EIP-2612 signature
  | { step: "approving" } // approve tx in flight (permit-unavailable fallback)
  | { step: "confirming" } // awaiting the ask tx confirmation in the wallet
  | { step: "pending"; hash: Hex } // ask tx submitted, waiting for the receipt
  | { step: "indexing"; id: string; hash: Hex; slow: boolean } // waiting for the indexer → open
  | { step: "confirmed"; id: string; hash: Hex; status: QuestionStatus }
  | { step: "rejected"; message: string } // user declined a signature/tx in the wallet
  | { step: "error"; message: string }; // server / network / on-chain failure

export interface UseAskAndPay {
  phase: AskPhase;
  /** Kick off the full flow (create → pay → confirm). */
  submit: (input: AskInput) => void;
  /** Retry from the safe point: re-pay the already-created question, or re-create if none exists yet. */
  retry: () => void;
  /** Force an immediate indexer re-check while in the `indexing` state. */
  recheck: () => void;
  /** Return to the editable form. */
  reset: () => void;
  /** True while the flow is mid-run (form should be disabled). */
  busy: boolean;
}

const BUSY_STEPS: ReadonlySet<AskPhase["step"]> = new Set([
  "creating",
  "checking",
  "permitting",
  "approving",
  "confirming",
  "pending",
  "indexing",
]);

function mapCreateError(e: unknown): AskPhase {
  if (e instanceof ApiError) {
    if (e.code === "amount_below_min") {
      return { step: "error", message: "Amount is below the creator's minimum price." };
    }
    if (e.code === "answerer_not_found") {
      return { step: "error", message: "This creator no longer exists." };
    }
    if (e.code === "validation_error") {
      return { step: "error", message: "Please check your question and amount, then try again." };
    }
    if (e.status === 401)
      return { step: "error", message: "Your session expired — sign in again." };
    return { step: "error", message: e.message };
  }
  if (e instanceof NetworkError) return { step: "error", message: e.message };
  return { step: "error", message: "Couldn't create your question. Please try again." };
}

export function useAskAndPay(): UseAskAndPay {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();

  const [phase, setPhaseState] = useState<AskPhase>({ step: "idle" });

  // Cancellation + wake refs survive re-renders. `runToken` invalidates state writes from a stale run
  // (e.g. after reset or unmount); `wake` lets `recheck` interrupt the indexing sleep immediately.
  const runTokenRef = useRef(0);
  const mountedRef = useRef(true);
  const wakeRef = useRef<(() => void) | null>(null);
  const lastInputRef = useRef<AskInput | null>(null);
  const pendingIdRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runTokenRef.current += 1; // cancel any in-flight loop
      wakeRef.current?.();
    };
  }, []);

  const setPhase = useCallback((token: number, next: AskPhase) => {
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

  // Poll the API until the indexer flips the question off `pending_payment`. The tx already succeeded, so
  // a transient read failure is not fatal — keep polling; the money is safely escrowed on-chain.
  const indexLoop = useCallback(
    async (token: number, id: string, hash: Hex) => {
      let attempts = 0;
      for (;;) {
        if (token !== runTokenRef.current) return;
        try {
          const { question } = await getQuestion(id);
          if (question.status !== "pending_payment") {
            track("payment_confirmed", { id, status: question.status });
            setPhase(token, { step: "confirmed", id, hash, status: question.status });
            return;
          }
        } catch {
          // transient — retry on the next tick
        }
        attempts += 1;
        setPhase(token, { step: "indexing", id, hash, slow: attempts >= SLOW_AFTER_POLLS });
        await interruptibleSleep(POLL_INTERVAL_MS);
      }
    },
    [setPhase, interruptibleSleep],
  );

  // Shared tail once an ask tx hash exists: wait for the receipt, then hand off to the indexer poll.
  const afterSend = useCallback(
    async (token: number, id: string, hash: Hex) => {
      setPhase(token, { step: "pending", hash });
      if (!publicClient) throw new Error("No RPC client available.");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction reverted on-chain.");
      if (token !== runTokenRef.current) return;
      setPhase(token, { step: "indexing", id, hash, slow: false });
      await indexLoop(token, id, hash);
    },
    [publicClient, setPhase, indexLoop],
  );

  const pay = useCallback(
    async (token: number, id: string, owner: Address, ask: AskParams) => {
      const escrow = escrowAddressFor(chainId);
      const usdc = usdcAddressFor(chainId);
      if (!escrow || !usdc || !publicClient) {
        setPhase(token, { step: "error", message: "This network isn't set up for payments." });
        return;
      }
      // A `const` narrowed by the guard above; inner helpers reference it without a non-null assertion.
      const client = publicClient;

      setPhase(token, { step: "checking" });
      let balance: bigint;
      let allowance: bigint;
      try {
        [balance, allowance] = await Promise.all([
          client.readContract({
            address: usdc,
            abi: usdcAbi,
            functionName: "balanceOf",
            args: [owner],
          }),
          client.readContract({
            address: usdc,
            abi: usdcAbi,
            functionName: "allowance",
            args: [owner, escrow],
          }),
        ]);
      } catch {
        setPhase(token, { step: "error", message: "Couldn't read your USDC balance. Try again." });
        return;
      }
      if (token !== runTokenRef.current) return;
      if (balance < ask.amount) {
        setPhase(token, { step: "insufficient", balance, needed: ask.amount });
        return;
      }

      try {
        // Fast path: allowance already covers it → straight to askQuestion.
        if (allowance >= ask.amount) {
          await sendPlainAsk(token, id, escrow, owner, ask);
          return;
        }

        // Preferred path: a single EIP-2612 permit signature bundled into askQuestionWithPermit.
        let permit: Awaited<ReturnType<typeof signPermit>> | null = null;
        try {
          setPhase(token, { step: "permitting" });
          permit = await signPermit(owner, escrow, usdc, ask.amount);
        } catch (e) {
          if (isUserRejection(e)) {
            setPhase(token, { step: "rejected", message: "You cancelled the signature request." });
            return;
          }
          permit = null; // wallet/token can't permit → fall back to approve + ask
        }

        if (permit && (await permitSimulates(escrow, owner, ask, permit))) {
          setPhase(token, { step: "confirming" });
          const hash = await writeContractAsync({
            address: escrow,
            abi: buyAnAnswerEscrowAbi,
            functionName: "askQuestionWithPermit",
            args: askQuestionWithPermitArgs(ask, permit),
          });
          if (token !== runTokenRef.current) return;
          await afterSend(token, id, hash);
          return;
        }

        // Fallback: explicit approve, then a plain askQuestion.
        setPhase(token, { step: "approving" });
        const approveHash = await writeContractAsync({
          address: usdc,
          abi: usdcAbi,
          functionName: "approve",
          args: [escrow, ask.amount],
        });
        // Insist the approve actually succeeded, then wait until a chain read reflects it — the RPC is
        // read-after-write inconsistent, so simulating the ask straight off the receipt can hit a node
        // that hasn't applied the approve's block (ADR-0036 F1/F2). Bounded; a wait that times out falls
        // through to the simulate below, which reports whatever is really wrong.
        await confirmApproval({
          waitForReceipt: () => client.waitForTransactionReceipt({ hash: approveHash }),
          readAllowance: () =>
            client.readContract({
              address: usdc,
              abi: usdcAbi,
              functionName: "allowance",
              args: [owner, escrow],
            }),
          needed: ask.amount,
        });
        if (token !== runTokenRef.current) return;
        await sendPlainAsk(token, id, escrow, owner, ask);
      } catch (e) {
        if (token !== runTokenRef.current) return;
        if (isUserRejection(e)) {
          setPhase(token, {
            step: "rejected",
            message: "You cancelled the request in your wallet.",
          });
          return;
        }
        setPhase(token, { step: "error", message: txErrorMessage(e) });
      }

      // ── inner helpers (capture this run's escrow/usdc/publicClient) ──
      async function sendPlainAsk(
        tk: number,
        qid: string,
        escrowAddr: Address,
        ownerAddr: Address,
        p: AskParams,
      ) {
        // Simulate first so a revert (paused, etc.) surfaces a decoded reason before the wallet prompt.
        await client.simulateContract({
          address: escrowAddr,
          abi: buyAnAnswerEscrowAbi,
          functionName: "askQuestion",
          args: askQuestionArgs(p),
          account: ownerAddr,
        });
        setPhase(tk, { step: "confirming" });
        const hash = await writeContractAsync({
          address: escrowAddr,
          abi: buyAnAnswerEscrowAbi,
          functionName: "askQuestion",
          args: askQuestionArgs(p),
        });
        if (tk !== runTokenRef.current) return;
        await afterSend(tk, qid, hash);
      }

      async function signPermit(
        ownerAddr: Address,
        spender: Address,
        token_: Address,
        amount: bigint,
      ) {
        const [name, nonce] = await Promise.all([
          client.readContract({ address: token_, abi: usdcAbi, functionName: "name" }),
          client.readContract({
            address: token_,
            abi: usdcAbi,
            functionName: "nonces",
            args: [ownerAddr],
          }),
        ]);
        let version: string;
        try {
          version = await client.readContract({
            address: token_,
            abi: usdcAbi,
            functionName: "version",
          });
        } catch {
          version = "2"; // Circle FiatToken default; some deployments omit version()
        }
        const deadline = BigInt(Math.floor(Date.now() / 1000) + PERMIT_TTL_SECONDS);
        const typedData = buildUsdcPermitTypedData({
          chainId: chainId as number,
          token: token_,
          name,
          version,
          owner: ownerAddr,
          spender,
          value: amount,
          nonce,
          deadline,
        });
        const signature = await signTypedDataAsync(typedData);
        const parts = splitPermitSignature(signature);
        return { value: amount, deadline, ...parts };
      }

      async function permitSimulates(
        escrowAddr: Address,
        ownerAddr: Address,
        p: AskParams,
        permit: { value: bigint; deadline: bigint; v: number; r: Hex; s: Hex },
      ): Promise<boolean> {
        try {
          await client.simulateContract({
            address: escrowAddr,
            abi: buyAnAnswerEscrowAbi,
            functionName: "askQuestionWithPermit",
            args: askQuestionWithPermitArgs(p, permit),
            account: ownerAddr,
          });
          return true;
        } catch {
          return false;
        }
      }
    },
    [chainId, publicClient, setPhase, afterSend, writeContractAsync, signTypedDataAsync],
  );

  const startPay = useCallback(
    (id: string, input: AskInput) => {
      runTokenRef.current += 1;
      const token = runTokenRef.current;
      if (!address) {
        setPhase(token, { step: "error", message: "Connect your wallet to pay." });
        return;
      }
      if (!canAskOn(chainId)) {
        setPhase(token, { step: "error", message: "Switch to Base Sepolia to pay." });
        return;
      }
      const ask: AskParams = {
        ref: refForQuestion(id),
        answerer: input.answerer,
        amount: input.amount,
      };
      void pay(token, id, address, ask);
    },
    [address, chainId, pay, setPhase],
  );

  const submit = useCallback(
    (input: AskInput) => {
      lastInputRef.current = input;
      pendingIdRef.current = null;
      runTokenRef.current += 1;
      const token = runTokenRef.current;

      if (!address) {
        setPhase(token, { step: "error", message: "Connect your wallet to pay." });
        return;
      }
      if (!canAskOn(chainId)) {
        setPhase(token, { step: "error", message: "Switch to Base Sepolia to pay." });
        return;
      }

      void (async () => {
        setPhase(token, { step: "creating" });
        let id: string;
        try {
          const res = await postQuestion({
            handle: input.handle,
            body: input.body,
            amountUsdc: input.amount.toString(),
            ...(chainId !== undefined ? { chainId } : {}),
          });
          id = res.id;
          track("question_created", { id, chainId: chainId ?? null });
        } catch (e) {
          setPhase(token, mapCreateError(e));
          return;
        }
        if (token !== runTokenRef.current) return;
        pendingIdRef.current = id;
        startPay(id, input);
      })();
    },
    [address, chainId, setPhase, startPay],
  );

  const retry = useCallback(() => {
    const input = lastInputRef.current;
    if (!input) return;
    // Re-pay the already-minted question (never POST a second time); else start the whole flow over.
    if (pendingIdRef.current) startPay(pendingIdRef.current, input);
    else submit(input);
  }, [startPay, submit]);

  const recheck = useCallback(() => {
    wakeRef.current?.();
  }, []);

  const reset = useCallback(() => {
    runTokenRef.current += 1; // cancel loops
    wakeRef.current?.();
    pendingIdRef.current = null;
    lastInputRef.current = null;
    setPhaseState({ step: "idle" });
  }, []);

  return { phase, submit, retry, recheck, reset, busy: BUSY_STEPS.has(phase.step) };
}
