// SPDX-License-Identifier: MIT
// The compose + review + pay surface. The asker writes a question and chooses an amount (≥ the creator's
// minimum, tip optional), then pays — running the chain-first flow in useAskAndPay. On success the whole
// card is replaced by an escrow confirmation that reflects the INDEXER-written status (never an optimistic
// client guess). Money is base-unit BigInt end-to-end; the display uses the shared USDC helpers.

import { usdcAbi } from "@buyananswer/sdk";
import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { useAskAndPay } from "../../hooks/useAskAndPay";
import type { PublicCreator } from "../../lib/api";
import { explorerFor, usdcAddressFor } from "../../lib/chains";
import { formatUsdc, parseUsdc } from "../../lib/usdc";
import { Avatar } from "../Avatar";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import { LinkButton } from "../ui/LinkButton";
import { Textarea } from "../ui/Textarea";
import { AskStatus } from "./AskStatus";
import styles from "./ask.module.css";

const MAX_BODY = 2000;

function CreatorHead({ creator }: { creator: PublicCreator }) {
  return (
    <div className={styles.creatorHead}>
      <Avatar src={creator.avatarUrl} name={creator.displayName} size={48} />
      <div className={styles.creatorMeta}>
        <span className={styles.creatorName}>{creator.displayName}</span>
        <span className={styles.creatorHandle}>@{creator.handle}</span>
      </div>
    </div>
  );
}

export function AskComposer({ creator }: { creator: PublicCreator }) {
  const { address, chainId } = useAccount();
  const { phase, submit, retry, recheck, reset, busy } = useAskAndPay();

  const [body, setBody] = useState("");
  const [amount, setAmount] = useState(() => formatUsdc(creator.minPriceUsdc));
  const [attempted, setAttempted] = useState(false);

  const usdc = usdcAddressFor(chainId);
  const balanceQuery = useReadContract({
    address: usdc ?? undefined,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(usdc && address), refetchInterval: 15_000 },
  });
  const balance = balanceQuery.data;

  const minBase = BigInt(creator.minPriceUsdc);
  const amountBase = parseUsdc(amount);

  const bodyError =
    body.trim().length === 0
      ? "Write your question."
      : body.length > MAX_BODY
        ? `Keep it under ${MAX_BODY} characters.`
        : null;

  const amountError = (() => {
    if (amount.trim() === "") return "Enter an amount.";
    if (amountBase === null) return "Enter a USDC amount (up to 6 decimals).";
    const n = BigInt(amountBase);
    if (n < minBase) return `Minimum is ${formatUsdc(creator.minPriceUsdc)} USDC.`;
    if (balance !== undefined && n > balance) {
      return `You only have ${formatUsdc(balance.toString())} USDC.`;
    }
    return null;
  })();

  const canSubmit = !bodyError && !amountError && amountBase !== null;

  function onSubmit() {
    setAttempted(true);
    if (!canSubmit || amountBase === null) return;
    submit({
      handle: creator.handle,
      body: body.trim(),
      amount: BigInt(amountBase),
      answerer: creator.wallet,
    });
  }

  // Success: the escrow is confirmed (indexer flipped the question off pending_payment).
  if (phase.step === "confirmed") {
    const explorerBase = explorerFor(chainId);
    const txHref = explorerBase ? `${explorerBase}/tx/${phase.hash}` : null;
    return (
      <div className="page-narrow stack">
        <Card>
          <div className={styles.done}>
            <div className={styles.check} aria-hidden="true">
              ✓
            </div>
            <div className="stack" style={{ gap: "var(--space-2)", textAlign: "center" }}>
              <h1 className="panel-title" style={{ fontSize: "var(--text-xl)" }}>
                You're all set
              </h1>
              <p className="muted">
                Your USDC is held safe on Base for {creator.displayName}. You're only charged if
                they answer — if they decline or the <strong>7-day</strong> window passes, you get
                it all back.
              </p>
            </div>
            {txHref ? (
              <a className={styles.txLink} href={txHref} target="_blank" rel="noreferrer">
                View transaction ↗
              </a>
            ) : null}
            <div className={styles.actions} style={{ justifyContent: "center" }}>
              <Button onClick={reset}>Ask another question</Button>
              <LinkButton to={`/${creator.handle}`} variant="secondary">
                Back to @{creator.handle}
              </LinkButton>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const balanceText = balance !== undefined ? `${formatUsdc(balance.toString())} USDC` : "—";

  return (
    <div className="page-narrow stack">
      <Card>
        <div className="stack">
          <CreatorHead creator={creator} />

          <Textarea
            label="Your question"
            placeholder={`Ask ${creator.displayName} anything…`}
            value={body}
            maxLength={MAX_BODY}
            showCount
            rows={5}
            disabled={busy}
            onChange={(e) => setBody(e.target.value)}
            error={attempted && bodyError ? bodyError : undefined}
          />

          <Input
            label="Amount (USDC)"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            disabled={busy}
            onChange={(e) => setAmount(e.target.value)}
            hint={`Minimum ${formatUsdc(creator.minPriceUsdc)} USDC — tip more to show support (it doesn't buy priority).`}
            error={attempted && amountError ? amountError : undefined}
          />

          <div className={styles.balanceRow}>
            <span>Your balance</span>
            <span className={styles.balanceValue}>{balanceText}</span>
          </div>

          <div className={styles.total}>
            <span className={styles.totalLabel}>You'll send</span>
            <span className={styles.totalValue}>
              {amountBase ? formatUsdc(amountBase) : "0"} USDC
            </span>
          </div>

          <Button fullWidth size="lg" onClick={onSubmit} isLoading={busy} disabled={busy}>
            {busy ? "Working…" : "Ask & pay"}
          </Button>

          <AskStatus
            phase={phase}
            explorerBase={explorerFor(chainId)}
            onRetry={retry}
            onRecheck={recheck}
            onReset={reset}
          />

          <p className="subtle" style={{ textAlign: "center" }}>
            Your USDC is held safe on Base — you're only charged when they answer, and refunded if
            they don't.
          </p>
        </div>
      </Card>
    </div>
  );
}
