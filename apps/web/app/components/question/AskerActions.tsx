// SPDX-License-Identifier: MIT
// The asker's action surface for an OPEN question. Which action is offered depends on the on-chain answer
// window (FUNCTIONAL_SPEC §5): before the deadline the asker may **cancel** (refunded minus the 1% cancel
// fee); on/after it, they may **reclaim** for free (the escrow auto-expires in the asker's favour). Both
// are chain-first via useSettleAction — poll the indexer for the terminal status; never guess client-side.
// (Reclaim is permissionless on-chain, but here it's the asker reclaiming their own funds.)

import type { Address } from "@buyananswer/shared";
import { useEffect } from "react";
import { useSettleAction } from "../../hooks/useSettleAction";
import type { QuestionDetail } from "../../lib/api";
import { explorerFor } from "../../lib/chains";
import { formatDate } from "../../lib/format";
import { CANCEL_FEE_PERCENT, askerActionFor, deadlineCountdown } from "../../lib/status";
import { ConfirmButton } from "../ui/ConfirmButton";
import { SettleStatus } from "./SettleStatus";
import { WalletActionGate } from "./WalletActionGate";
import styles from "./question.module.css";

export function AskerActions({
  detail,
  sessionWallet,
  onSettled,
}: { detail: QuestionDetail; sessionWallet: Address; onSettled: () => void }) {
  const q = detail.question;
  const onchainId = q.onchainId ? BigInt(q.onchainId) : null;
  const explorerBase = explorerFor(q.chainId);
  const action = askerActionFor(q.status, q.answerDeadline);

  const cancel = useSettleAction("cancel");
  const reclaim = useSettleAction("reclaim");

  const cancelStep = cancel.phase.step;
  const reclaimStep = reclaim.phase.step;
  useEffect(() => {
    if (cancelStep === "confirmed" || reclaimStep === "confirmed") onSettled();
  }, [cancelStep, reclaimStep, onSettled]);

  if (onchainId === null) {
    return (
      <p className={styles.note}>This question is still being indexed. Refresh in a moment.</p>
    );
  }

  const runInput = { questionId: q.id, onchainId };
  const active = cancelStep !== "idle" ? cancel : reclaimStep !== "idle" ? reclaim : null;
  const activeLabel = cancelStep !== "idle" ? "cancellation" : "reclaim";

  return (
    <section className="stack">
      <div className={styles.meta}>
        <div className={styles.metaRow}>
          <span className={styles.metaKey}>Answer window</span>
          <span className={styles.metaValue}>
            {formatDate(q.answerDeadline)}
            {deadlineCountdown(q.answerDeadline) ? ` · ${deadlineCountdown(q.answerDeadline)}` : ""}
          </span>
        </div>
      </div>

      <WalletActionGate sessionWallet={sessionWallet}>
        {action === "reclaim" ? (
          <div className="stack" style={{ gap: "var(--space-3)" }}>
            <ConfirmButton
              size="lg"
              disabled={reclaim.busy}
              question="Get your money back? The answer window has closed unanswered, so you're refunded in full. This can't be undone."
              confirmLabel="Reclaim my funds"
              onConfirm={() => {
                cancel.reset();
                reclaim.run(runInput);
              }}
            >
              Reclaim my funds
            </ConfirmButton>
            <p className={styles.note}>
              The 7-day window passed without an answer, so you can take your full payment back — no
              fee. It lands in your balance to withdraw.
            </p>
          </div>
        ) : (
          <div className="stack" style={{ gap: "var(--space-3)" }}>
            <ConfirmButton
              variant="danger"
              size="lg"
              disabled={cancel.busy}
              question={`Cancel this question and get refunded? You'll get your money back minus the ${CANCEL_FEE_PERCENT} cancel fee. This can't be undone.`}
              confirmLabel="Yes, cancel & refund"
              onConfirm={() => {
                reclaim.reset();
                cancel.run(runInput);
              }}
            >
              Cancel &amp; refund
            </ConfirmButton>
            <p className={styles.note}>
              Before the deadline you can cancel for a {CANCEL_FEE_PERCENT} fee (refunded the rest).
              After it, getting it all back is free. Your refund waits in your balance to withdraw.
            </p>
          </div>
        )}
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
