// SPDX-License-Identifier: MIT
// Wrong-network guard: the wallet is connected but on a chain the app doesn't support. Offers a
// one-click switch to each supported chain (Base + Base Sepolia). Handles the switch-rejected / not-
// added error states.

import { useAccount, useSwitchChain } from "wagmi";
import { SUPPORTED_CHAINS, chainName } from "../lib/chains";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

export function NetworkGuard() {
  const { chainId } = useAccount();
  const { switchChain, isPending, variables, error } = useSwitchChain();

  return (
    <Card>
      <div className="stack">
        <div className="stack">
          <h1 className="panel-title">Wrong network</h1>
          <p className="muted">
            You're connected to <strong>{chainName(chainId)}</strong>. BuyAnAnswer runs on Base —
            switch networks to continue.
          </p>
        </div>
        <div className="row">
          {SUPPORTED_CHAINS.map((chain) => (
            <Button
              key={chain.id}
              onClick={() => switchChain({ chainId: chain.id })}
              isLoading={isPending && variables?.chainId === chain.id}
            >
              Switch to {chain.name}
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
