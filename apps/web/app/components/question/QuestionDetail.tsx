// SPDX-License-Identifier: MIT
// The `/questions/:id` detail + action surface. Reads participant-scoped detail from the API (cookie
// session), then renders the right panel for the viewer's role and the question's status:
//   • answerer + open      → AnswerPanel (answer / decline)
//   • answerer + answered  → the revealed answer + PublishPanel
//   • asker + open         → AskerActions (cancel / reclaim, deadline-driven)
//   • answered (any role)  → the revealed answer (the paywall is open once `answered`)
//   • terminal (non-answered) → a plain-language outcome note
// All money-state is read from the API/indexer — never guessed client-side. On any settle, the detail is
// refetched so the header + outcome reflect the new indexed status.

import type { QuestionStatus } from "@buyananswer/shared";
import { useQuery } from "@tanstack/react-query";
import { ApiError, type Me, getQuestion } from "../../lib/api";
import { explorerFor } from "../../lib/chains";
import { cx } from "../../lib/cx";
import { formatDate, truncateAddress } from "../../lib/format";
import { isTerminalStatus, roleFor } from "../../lib/status";
import { formatUsdcAmount } from "../../lib/usdc";
import { StatusBadge } from "../inbox/StatusBadge";
import { EmptyState } from "../states/EmptyState";
import { ErrorState } from "../states/ErrorState";
import { LoadingState } from "../states/LoadingState";
import { Card } from "../ui/Card";
import { LinkButton } from "../ui/LinkButton";
import { AnswerPanel, PublishPanel } from "./AnswerPanel";
import { AskerActions } from "./AskerActions";
import styles from "./question.module.css";

/** A plain-language money outcome for a settled question, from the viewer's perspective. */
function outcomeText(status: QuestionStatus, role: "asker" | "answerer" | null): string {
  switch (status) {
    case "answered":
      return role === "answerer"
        ? "You answered this question. Your payout (the amount minus the 4.2% fee) is in your balance to withdraw."
        : "This question was answered — you paid for the answer above.";
    case "declined":
      return role === "answerer"
        ? "You declined this question. The asker was refunded in full."
        : "The creator declined, so your payment was refunded in full — it's in your balance to withdraw.";
    case "cancelled":
      return role === "answerer"
        ? "The asker cancelled this question before it was answered."
        : "You cancelled this question. Your refund (minus the 1% cancel fee) is in your balance to withdraw.";
    case "reclaimed":
      return role === "answerer"
        ? "This question expired unanswered and the asker took their money back."
        : "The answer window passed, so you got your full payment back — it's in your balance to withdraw.";
    default:
      return "";
  }
}

function NotFound() {
  return (
    <EmptyState
      title="Question not found"
      message="This question doesn't exist, or you're not a participant in it."
      action={<LinkButton to="/dashboard">Back to dashboard</LinkButton>}
    />
  );
}

export function QuestionDetail({ id, me }: { id: string; me: Me }) {
  const detailQuery = useQuery({
    queryKey: ["question", id],
    queryFn: () => getQuestion(id),
    retry: false,
  });

  if (detailQuery.isPending) return <LoadingState message="Loading question…" />;
  if (detailQuery.isError) {
    if (detailQuery.error instanceof ApiError && detailQuery.error.status === 404)
      return <NotFound />;
    return (
      <ErrorState
        title="Can't reach the server"
        message="We couldn't load this question. Please try again."
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }

  const detail = detailQuery.data;
  const q = detail.question;
  const role = roleFor(me.wallet, q);
  const refetch = () => void detailQuery.refetch();
  const explorerBase = explorerFor(q.chainId);
  const onchainTxHref =
    explorerBase && q.onchainId ? `${explorerBase}/address/${q.answererWallet}` : null;

  return (
    <div className="page-narrow stack">
      <Card>
        <div className="stack">
          <div className={styles.detailHead}>
            <StatusBadge status={q.status} />
            <span className={styles.amount}>
              {q.amountUsdc ? formatUsdcAmount(q.amountUsdc) : "—"}
            </span>
          </div>
          <p className={styles.body}>{q.body}</p>
          <div className={styles.meta}>
            <div className={styles.metaRow}>
              <span className={styles.metaKey}>{role === "answerer" ? "From" : "To"}</span>
              <span className={cx(styles.metaValue, styles.mono)}>
                {truncateAddress(role === "answerer" ? q.askerWallet : q.answererWallet)}
              </span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaKey}>Asked</span>
              <span className={styles.metaValue}>{formatDate(q.createdAt)}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* The revealed answer — visible to both parties once the question is answered (paywall open). */}
      {q.status === "answered" ? (
        <Card>
          <div className="stack">
            <h2 className="panel-title" style={{ fontSize: "var(--text-xl)" }}>
              Answer
            </h2>
            {detail.answer?.body ? (
              <p className={styles.answerBody}>{detail.answer.body}</p>
            ) : (
              <p className={styles.note}>
                This question was answered on-chain, but no answer text was saved before the reveal,
                so there's nothing to display. Answers can't be edited after settling.
              </p>
            )}
            <p className={styles.note}>{outcomeText("answered", role)}</p>
            {role === "answerer" ? (
              <PublishPanel questionId={q.id} isPublic={q.isPublic} onPublished={refetch} />
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* Open-question action panels. */}
      {q.status === "open" && role === "answerer" ? (
        <Card>
          <AnswerPanel detail={detail} sessionWallet={me.wallet} onSettled={refetch} />
        </Card>
      ) : null}
      {q.status === "open" && role === "asker" ? (
        <Card>
          <AskerActions detail={detail} sessionWallet={me.wallet} onSettled={refetch} />
        </Card>
      ) : null}

      {/* Terminal (non-answered) outcome. */}
      {isTerminalStatus(q.status) && q.status !== "answered" ? (
        <Card>
          <div className="stack" style={{ gap: "var(--space-3)" }}>
            <p className={styles.note}>{outcomeText(q.status, role)}</p>
            {onchainTxHref ? (
              <a className={styles.txLink} href={onchainTxHref} target="_blank" rel="noreferrer">
                View on-chain ↗
              </a>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* Still awaiting payment (asked but not yet escrowed / indexed). */}
      {q.status === "pending_payment" ? (
        <Card>
          <p className={styles.note}>
            This question is awaiting payment confirmation. It becomes actionable once the payment
            is confirmed on-chain.
          </p>
        </Card>
      ) : null}

      <div>
        <LinkButton to="/dashboard" variant="ghost" size="sm">
          ← Back to dashboard
        </LinkButton>
      </div>
    </div>
  );
}
