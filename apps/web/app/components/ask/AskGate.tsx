// SPDX-License-Identifier: MIT
// Gates the ask flow: an asker must be (1) signed in (a cookie session — that's who the question is
// attributed to), and (2) connected with that same wallet on an ask-capable chain (a deployed escrow +
// USDC) to actually pay. Each precondition is its own state (§10): loading, connect, wrong-network,
// wrong-account, sign-in. Server authz is still authoritative — this gating is UX only.

import type { ReactNode } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { useMe } from "../../hooks/useMe";
import type { Me, PublicCreator } from "../../lib/api";
import { DEFAULT_ASK_CHAIN, canAskOn, isSupportedChainId } from "../../lib/chains";
import { truncateAddress } from "../../lib/format";
import { Avatar } from "../Avatar";
import { ConnectPanel } from "../ConnectPanel";
import { NetworkGuard } from "../NetworkGuard";
import { SignInPanel } from "../SignInPanel";
import { ErrorState } from "../states/ErrorState";
import { LoadingState } from "../states/LoadingState";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { AskComposer } from "./AskComposer";
import styles from "./ask.module.css";

/** A small "you're asking @handle" banner shown above the sign-in / connect steps. */
function AskIntro({ creator, lead }: { creator: PublicCreator; lead: string }) {
  return (
    <Card>
      <div className="stack" style={{ gap: "var(--space-3)" }}>
        <div className={styles.creatorHead}>
          <Avatar src={creator.avatarUrl} name={creator.displayName} size={44} />
          <div className={styles.creatorMeta}>
            <span className={styles.creatorName}>Ask {creator.displayName}</span>
            <span className={styles.creatorHandle}>@{creator.handle}</span>
          </div>
        </div>
        <p className="muted">{lead}</p>
      </div>
    </Card>
  );
}

/** Ask-capable chain guard: prompt a switch to Base Sepolia (the deployed escrow chain). */
function AskNetworkGuard() {
  const { switchChain, isPending, error } = useSwitchChain();
  return (
    <Card>
      <div className="stack">
        <div className="stack">
          <h1 className="panel-title">Switch network to pay</h1>
          <p className="muted">
            Paid questions settle on <strong>{DEFAULT_ASK_CHAIN.name}</strong>. Switch networks to
            continue.
          </p>
        </div>
        <div className="row">
          <Button
            onClick={() => switchChain({ chainId: DEFAULT_ASK_CHAIN.id })}
            isLoading={isPending}
          >
            Switch to {DEFAULT_ASK_CHAIN.name}
          </Button>
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error.message}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/** Signed in, wallet connected on an ask-capable chain, but a DIFFERENT account than the session. */
function AccountMismatch({
  creator,
  sessionWallet,
}: { creator: PublicCreator; sessionWallet: string }) {
  return (
    <div className="page-narrow stack">
      <AskIntro
        creator={creator}
        lead={`You're signed in as ${truncateAddress(sessionWallet)} but your wallet is on a different account. Sign in with the connected wallet to ask from it.`}
      />
      <SignInPanel />
    </div>
  );
}

/** Session exists; now require a connected wallet on an ask-capable chain with the matching account. */
function AskWalletGate({ creator, me }: { creator: PublicCreator; me: Me }) {
  const { address, isConnected, chainId } = useAccount();

  if (!isConnected || !address) {
    return (
      <div className="page-narrow stack">
        <AskIntro creator={creator} lead="Connect your wallet to pay for your question." />
        <ConnectPanel />
      </div>
    );
  }
  if (!canAskOn(chainId)) return <AskNetworkGuard />;
  if (address.toLowerCase() !== me.wallet.toLowerCase()) {
    return <AccountMismatch creator={creator} sessionWallet={me.wallet} />;
  }
  return <AskComposer creator={creator} />;
}

/** Unauthenticated: walk connect → correct-network → sign-in, framed for the ask. */
function AskSignIn({ creator }: { creator: PublicCreator }) {
  const { isConnected, chainId } = useAccount();
  let panel: ReactNode;
  if (!isConnected) panel = <ConnectPanel />;
  else if (!isSupportedChainId(chainId)) panel = <NetworkGuard />;
  else panel = <SignInPanel />;

  return (
    <div className="page-narrow stack">
      <AskIntro
        creator={creator}
        lead="Sign in with your wallet to ask a paid question. It's a signature — no gas."
      />
      {panel}
    </div>
  );
}

export function AskGate({ creator }: { creator: PublicCreator }) {
  const me = useMe();

  if (me.isLoading) return <LoadingState message="Loading your account…" />;
  if (me.isError) {
    return (
      <ErrorState
        title="Can't reach the server"
        message="We couldn't load your account. Please try again."
        onRetry={() => void me.refetch()}
      />
    );
  }
  if (!me.data) return <AskSignIn creator={creator} />;
  return <AskWalletGate creator={creator} me={me.data} />;
}
