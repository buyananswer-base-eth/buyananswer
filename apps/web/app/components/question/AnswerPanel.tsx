// SPDX-License-Identifier: MIT
// The answerer's action surface for an OPEN question: write the hidden answer, then either "Answer & get
// paid" (save the draft → answerQuestion tx → reveal after indexing) or "Decline & refund" (declineQuestion
// tx → asker refunded 100%). Both are chain-first via useSettleAction — the client never writes money-state.
// The answer draft MUST be saved before the answer tx (the indexer marks `answered` from chain truth even
// with no body, after which the answer route 409s), so saving is the tx's preflight. PublishPanel (below)
// is the answered-state affordance to opt the Q&A into a public card.

import type { Address } from "@buyananswer/shared";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { type SettleRunInput, useSettleAction } from "../../hooks/useSettleAction";
import { track } from "../../lib/analytics";
import {
  ApiError,
  NetworkError,
  type QuestionDetail,
  postAnswer,
  postPublish,
} from "../../lib/api";
import { explorerFor } from "../../lib/chains";
import { ANSWER_FEE_PERCENT } from "../../lib/status";
import { Button } from "../ui/Button";
import { ConfirmButton } from "../ui/ConfirmButton";
import { Textarea } from "../ui/Textarea";
import { SettleStatus } from "./SettleStatus";
import { WalletActionGate } from "./WalletActionGate";
import styles from "./question.module.css";

const MAX_ANSWER = 5000;

/** Map an answer-draft save failure to a user-facing message (the preflight must reject with `.message`). */
function draftErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 409 || e.code === "answer_locked") {
      return "This question was just answered on-chain, so the answer can no longer be edited.";
    }
    if (e.status === 401) return "Your session expired — sign in again.";
    if (e.code === "validation_error") return "Please check your answer, then try again.";
    return e.message;
  }
  if (e instanceof NetworkError) return e.message;
  return "Couldn't save your answer. Please try again.";
}

export function AnswerPanel({
  detail,
  sessionWallet,
  onSettled,
}: { detail: QuestionDetail; sessionWallet: Address; onSettled: () => void }) {
  const q = detail.question;
  const onchainId = q.onchainId ? BigInt(q.onchainId) : null;
  const explorerBase = explorerFor(q.chainId);

  const answer = useSettleAction("answer");
  const decline = useSettleAction("decline");

  const [text, setText] = useState(detail.answer?.body ?? "");
  const [touched, setTouched] = useState(false);
  const textRef = useRef(text);
  textRef.current = text;

  // When either action confirms, refetch the detail so the view flips to the answered/declined state.
  const answerStep = answer.phase.step;
  const declineStep = decline.phase.step;
  useEffect(() => {
    if (answerStep === "confirmed" || declineStep === "confirmed") onSettled();
  }, [answerStep, declineStep, onSettled]);

  if (onchainId === null) {
    return (
      <p className={styles.note}>
        This question is still being indexed. Refresh in a moment to answer it.
      </p>
    );
  }

  const busy = answer.busy || decline.busy;
  const trimmed = text.trim();
  const textError =
    trimmed.length === 0
      ? "Write your answer."
      : text.length > MAX_ANSWER
        ? `Keep it under ${MAX_ANSWER.toLocaleString()} characters.`
        : null;

  const saveDraft = async () => {
    try {
      await postAnswer(q.id, textRef.current.trim());
    } catch (e) {
      throw new Error(draftErrorMessage(e));
    }
  };

  const runInput: SettleRunInput = { questionId: q.id, onchainId };

  // Which action is live (only one runs at a time — the other button is disabled while busy).
  const active = answerStep !== "idle" ? answer : declineStep !== "idle" ? decline : null;
  const activeLabel = answerStep !== "idle" ? "answer" : "decline";

  return (
    <section className="stack">
      <div className="stack" style={{ gap: "var(--space-2)" }}>
        <h2 className="panel-title" style={{ fontSize: "var(--text-xl)" }}>
          Your answer
        </h2>
        <Textarea
          label={undefined}
          value={text}
          rows={6}
          maxLength={MAX_ANSWER}
          showCount
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="Write your answer…"
          hint="Only you can see this until you answer on-chain. It's revealed to the asker when the payment settles — and can't be edited after that."
          error={touched && textError ? textError : undefined}
        />
      </div>

      <WalletActionGate sessionWallet={sessionWallet}>
        <div className="stack" style={{ gap: "var(--space-3)" }}>
          <ConfirmButton
            fullWidth
            size="lg"
            disabled={busy || Boolean(textError)}
            question={`Answer now and get paid? Your USDC payout is the question amount minus the ${ANSWER_FEE_PERCENT} platform fee, and your answer is revealed to the asker. This can't be undone.`}
            confirmLabel="Answer & get paid"
            onConfirm={() => {
              decline.reset();
              answer.run({ ...runInput, preflight: saveDraft });
            }}
          >
            Answer &amp; get paid
          </ConfirmButton>
          <p className={styles.note}>
            You're paid the question amount minus the {ANSWER_FEE_PERCENT} platform fee. Your payout
            waits in your balance until you withdraw it.
          </p>

          <ConfirmButton
            variant="danger"
            disabled={busy}
            question="Decline this question? The asker is refunded in full and you're not paid. This can't be undone."
            confirmLabel="Yes, decline"
            onConfirm={() => {
              answer.reset();
              decline.run(runInput);
            }}
          >
            Decline &amp; refund
          </ConfirmButton>
        </div>
      </WalletActionGate>

      {active ? (
        <SettleStatus
          phase={active.phase}
          explorerBase={explorerBase}
          actionLabel={activeLabel}
          onRetry={active.retry}
          onRecheck={active.recheck}
          onReset={active.reset}
        />
      ) : null}
    </section>
  );
}

/** Answered-state affordance: opt the Q&A into a public card (`POST /questions/:id/publish`). */
export function PublishPanel({
  questionId,
  isPublic,
  onPublished,
}: { questionId: string; isPublic: boolean; onPublished: () => void }) {
  const publish = useMutation({
    mutationFn: () => postPublish(questionId),
    onSuccess: () => {
      track("card_published", { id: questionId });
      onPublished();
    },
  });

  if (isPublic) {
    return (
      <p className={styles.note}>
        This Q&amp;A is public — it can be shared as a card (the asker is shown only by wallet
        address).
      </p>
    );
  }

  return (
    <div className="stack" style={{ gap: "var(--space-3)" }}>
      <p className={styles.note}>
        Share this Q&amp;A publicly as a card. Your answer and the question become visible to
        anyone; the asker is shown only by wallet address.
      </p>
      <div className={styles.actions}>
        <Button variant="secondary" isLoading={publish.isPending} onClick={() => publish.mutate()}>
          Publish this Q&amp;A
        </Button>
      </div>
      {publish.isError ? (
        <p className="form-error" role="alert">
          {publish.error instanceof Error
            ? publish.error.message
            : "Couldn't publish. Please try again."}
        </p>
      ) : null}
    </div>
  );
}
