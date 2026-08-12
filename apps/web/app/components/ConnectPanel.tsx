// SPDX-License-Identifier: MIT
// The "connect a wallet" step: lists the configured wagmi connectors (injected + Coinbase Wallet,
// plus WalletConnect when a project id is set). Shows a per-connector loading state and any connect
// error (rejected request, no wallet, etc.).

import { useState } from "react";
import { useConnect } from "wagmi";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

export function ConnectPanel() {
  const { connectors, connect, isPending, error } = useConnect();
  const [pendingUid, setPendingUid] = useState<string | null>(null);

  return (
    <Card>
      <div className="stack">
        <div className="stack">
          <h1 className="panel-title">Connect your wallet</h1>
          <p className="muted">
            Sign in with your Ethereum wallet on Base. BuyAnAnswer never holds your keys or your
            money — you stay in control.
          </p>
        </div>
        <div className="stack">
          {connectors.map((connector) => (
            <Button
              key={connector.uid}
              variant="secondary"
              fullWidth
              isLoading={isPending && pendingUid === connector.uid}
              onClick={() => {
                setPendingUid(connector.uid);
                connect({ connector });
              }}
            >
              {connector.name}
            </Button>
          ))}
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
