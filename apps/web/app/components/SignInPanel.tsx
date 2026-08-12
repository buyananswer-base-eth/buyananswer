// SPDX-License-Identifier: MIT
// The SIWE step: wallet is connected on a supported chain, but there's no server session yet. One
// click runs nonce → sign → verify (see useSignIn), with granular loading sub-states and a friendly
// error line.

import { useAccount } from "wagmi";
import { type SignInStep, useSignIn } from "../hooks/useSignIn";
import { chainName } from "../lib/chains";
import { truncateAddress } from "../lib/format";
import { SIWE_STATEMENT } from "../lib/siwe";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

const STEP_LABEL: Partial<Record<SignInStep, string>> = {
  nonce: "Preparing…",
  "awaiting-signature": "Check your wallet…",
  verifying: "Verifying…",
};

export function SignInPanel() {
  const { address, chainId } = useAccount();
  const { signIn, step, error } = useSignIn();
  const busy = step !== "idle";

  return (
    <Card>
      <div className="stack">
        <div className="stack">
          <h1 className="panel-title">Sign in</h1>
          <p className="muted">
            Prove you own this wallet by signing “{SIWE_STATEMENT}”. It's just a signature — no gas,
            no transaction.
          </p>
        </div>
        <div className="row">
          <Badge tone="accent">{chainName(chainId)}</Badge>
          {address ? <span className="address">{truncateAddress(address)}</span> : null}
        </div>
        <Button fullWidth isLoading={busy} onClick={() => void signIn()}>
          {busy ? (STEP_LABEL[step] ?? "Signing in…") : "Sign in with Ethereum"}
        </Button>
        {step === "awaiting-signature" ? (
          <p className="subtle">Open your wallet and approve the signature request.</p>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
