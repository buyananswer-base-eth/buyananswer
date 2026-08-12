// SPDX-License-Identifier: MIT
// The pull-payment payout surface. Settling (answer/decline/cancel/reclaim) only *credits* the escrow's
// `withdrawable[account]`; money reaches a wallet solely via `withdraw()`. This card reads that on-chain
// balance (chain = source of truth) and offers a confirmed Withdraw. It's relevant to everyone: creators
// (answer payouts) and askers (refunds) both accrue a withdrawable balance — so it lives on the dashboard.

import { buyAnAnswerEscrowAbi } from "@buyananswer/sdk";
import type { ReactNode } from "react";
import { useAccount, useReadContract, useSwitchChain } from "wagmi";
import { useWithdraw } from "../../hooks/useWithdraw";
import { DEFAULT_ASK_CHAIN, canAskOn, escrowAddressFor, explorerFor } from "../../lib/chains";
import { cx } from "../../lib/cx";
import { formatUsdc } from "../../lib/usdc";
import questionStyles from "../question/question.module.css";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ConfirmButton } from "../ui/ConfirmButton";
import { Spinner } from "../ui/Spinner";
import styles from "./inbox.module.css";

function Frame({ children }: { children: ReactNode }) {
  return (
    <Card>
      <div className="stack">
        <h2 className="panel-title" style={{ fontSize: "var(--text-xl)" }}>
          Your balance
        </h2>
        {children}
      </div>
    </Card>
  );
}

export function WithdrawCard() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const escrow = escrowAddressFor(chainId);
  const explorerBase = explorerFor(chainId);

  const balanceQuery = useReadContract({
    address: escrow ?? undefined,
    abi: buyAnAnswerEscrowAbi,
    functionName: "withdrawable",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(escrow && address), refetchInterval: 20_000 },
  });

  const { phase, withdraw, busy } = useWithdraw(() => void balanceQuery.refetch());

  if (!isConnected || !address) {
    return (
      <Frame>
        <p className="muted">Connect your wallet to see your withdrawable balance.</p>
      </Frame>
    );
  }

  if (!canAskOn(chainId)) {
    return (
      <Frame>
        <p className="muted">
          Your withdrawable balance lives on <strong>{DEFAULT_ASK_CHAIN.name}</strong>. Switch
          networks to see and withdraw it.
        </p>
        <div className={styles.loadMore} style={{ justifyContent: "flex-start" }}>
          <Button
            size="sm"
            isLoading={switching}
            onClick={() => switchChain({ chainId: DEFAULT_ASK_CHAIN.id })}
          >
            Switch to {DEFAULT_ASK_CHAIN.name}
          </Button>
        </div>
      </Frame>
    );
  }

  const balance = balanceQuery.data;
  const hasBalance = balance !== undefined && balance > 0n;
  const txHref =
    phase.step === "success" && explorerBase ? `${explorerBase}/tx/${phase.hash}` : null;

  return (
    <Frame>
      <div className={styles.balance}>
        <span className={styles.balanceLabel}>Available to withdraw</span>
        <span className={styles.balanceValue}>
          {balanceQuery.isLoading ? (
            <Spinner size={16} label="Reading balance" />
          ) : balance !== undefined ? (
            `${formatUsdc(balance.toString())} USDC`
          ) : (
            "—"
          )}
        </span>
      </div>

      {hasBalance ? (
        <ConfirmButton
          disabled={busy}
          question="Withdraw your full balance to this wallet? This sends an on-chain transaction."
          confirmLabel="Withdraw"
          onConfirm={withdraw}
        >
          Withdraw
        </ConfirmButton>
      ) : (
        <p className="muted">
          Nothing to withdraw right now. Payouts and refunds land here after they settle on-chain.
        </p>
      )}

      {phase.step === "confirming" || phase.step === "pending" ? (
        <div className={questionStyles.status} aria-live="polite">
          <Spinner size={18} label="Withdrawing" />
          <div className={questionStyles.statusText}>
            <span>
              {phase.step === "confirming"
                ? "Confirm the withdrawal in your wallet…"
                : "Withdrawal sent — waiting for it to confirm…"}
            </span>
          </div>
        </div>
      ) : null}

      {phase.step === "success" ? (
        <div
          className={cx(questionStyles.status, questionStyles["tone-success"])}
          aria-live="polite"
        >
          <div className={questionStyles.statusText}>
            <strong>Withdrawn ✓</strong>
            <span>Your USDC is on its way to your wallet.</span>
            {txHref ? (
              <a className={styles.txLink} href={txHref} target="_blank" rel="noreferrer">
                View transaction ↗
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {phase.step === "rejected" || phase.step === "error" ? (
        <div
          className={cx(
            questionStyles.status,
            phase.step === "error" ? questionStyles["tone-danger"] : questionStyles["tone-warning"],
          )}
          role="alert"
        >
          <div className={questionStyles.statusText}>
            <span>{phase.message}</span>
          </div>
        </div>
      ) : null}
    </Frame>
  );
}
