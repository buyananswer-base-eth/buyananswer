// SPDX-License-Identifier: MIT
// The authenticated home panel. Reads from the cookie-backed `/me` session (independent of wallet
// reconnection), so it appears immediately after a refresh. Routes the creator into the right next
// step: claim a handle if there's no profile yet, or jump to the dashboard / board if there is. Warns
// if the connected wallet differs from the signed-in session, and can sign out (clears the cookie).

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount } from "wagmi";
import { ME_QUERY_KEY } from "../hooks/useMe";
import { type Me, postLogout } from "../lib/api";
import { truncateAddress } from "../lib/format";
import { CopyLink } from "./CopyLink";
import styles from "./SignedInPanel.module.css";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { LinkButton } from "./ui/LinkButton";

export function SignedInPanel({ me }: { me: Me }) {
  const { address: connected } = useAccount();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);

  const mismatch = connected && connected.toLowerCase() !== me.wallet.toLowerCase();

  async function signOut() {
    setSigningOut(true);
    try {
      await postLogout();
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <Card>
      <div className="stack">
        <div className={styles.header}>
          <h1 className="panel-title">You're signed in</h1>
          <Badge tone="success">session active</Badge>
        </div>

        {me.creator ? (
          <>
            <p className="muted">
              Your board is live at <strong>@{me.creator.handle}</strong>. Share your link or head
              to your dashboard.
            </p>
            <CopyLink handle={me.creator.handle} />
            <div className="row">
              <LinkButton to="/dashboard">Go to dashboard</LinkButton>
              <LinkButton to="/settings/profile" variant="secondary">
                Edit profile
              </LinkButton>
            </div>
          </>
        ) : (
          <>
            {/*
              Without a handle this used to offer ONLY "claim your handle", which dead-ended every
              signed-in user who is not a creator: an asker checking a question they paid for, or
              the fee wallet withdrawing. /dashboard already serves them — it renders the asked
              history and the withdrawable balance outside the creator branch — but nothing linked
              there, so it was unreachable without typing the URL. Claiming is the primary action
              for most people; it is not a prerequisite for using the app.
            */}
            <p className="muted">
              Claim a handle to get your public link and take paid questions — or head to your
              dashboard to see questions you've asked and withdraw any balance.
            </p>
            <div className="row">
              <LinkButton to="/onboarding">Claim your handle</LinkButton>
              <LinkButton to="/dashboard" variant="secondary">
                Go to dashboard
              </LinkButton>
            </div>
          </>
        )}

        <dl className={styles.details}>
          <div className={styles.row}>
            <dt className={styles.term}>Wallet</dt>
            <dd className="address">{me.wallet}</dd>
          </div>
        </dl>

        {mismatch ? (
          <output className="subtle">
            Heads up — your connected wallet ({truncateAddress(connected)}) differs from your
            signed-in session ({truncateAddress(me.wallet)}). Sign out to switch accounts.
          </output>
        ) : null}

        <div className="row">
          <Button variant="secondary" isLoading={signingOut} onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    </Card>
  );
}
