// SPDX-License-Identifier: MIT
// Gates an on-chain action inside the detail view. Reading a question needs only the cookie session, but
// *settling* needs a connected wallet — the session wallet — on an ask-capable chain (a deployed escrow +
// USDC). This renders a compact inline prompt for each unmet precondition (connect / switch / wrong
// account) and only shows its children (the action) when all hold. Server authz is still authoritative;
// this is UX. The account MUST equal the session wallet: the contract enforces caller == asker/answerer,
// so paying from a different connected account would just revert.

import type { Address } from "@buyananswer/shared";
import type { ReactNode } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { DEFAULT_ASK_CHAIN, canAskOn } from "../../lib/chains";
import { truncateAddress } from "../../lib/format";
import { ConnectPanel } from "../ConnectPanel";
import { Button } from "../ui/Button";
import styles from "./question.module.css";

export function WalletActionGate({
  sessionWallet,
  children,
}: { sessionWallet: Address; children: ReactNode }) {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain, isPending, error } = useSwitchChain();

  if (!isConnected || !address) {
    return <ConnectPanel />;
  }

  if (!canAskOn(chainId)) {
    return (
      <div className={styles.walletPrompt}>
        <span>
          Transactions settle on <strong>{DEFAULT_ASK_CHAIN.name}</strong>. Switch networks to
          continue.
        </span>
        <div className={styles.actions}>
          <Button
            size="sm"
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
    );
  }

  if (address.toLowerCase() !== sessionWallet.toLowerCase()) {
    return (
      <div className={styles.walletPrompt}>
        <span>
          You're signed in as <span className={styles.mono}>{truncateAddress(sessionWallet)}</span>{" "}
          but your wallet is on a different account. Switch your wallet to that account to continue.
        </span>
      </div>
    );
  }

  return <>{children}</>;
}
