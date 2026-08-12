// SPDX-License-Identifier: MIT
// Home: the connect → SIWE → authed-session flow, rendering the full async-state matrix. Session
// state comes from the cookie-backed `/me` query, so a valid session shows the signed-in panel
// immediately on load (survives refresh) regardless of wallet reconnection.

import { useAccount } from "wagmi";
import { ConnectPanel } from "../components/ConnectPanel";
import { NetworkGuard } from "../components/NetworkGuard";
import { SignInPanel } from "../components/SignInPanel";
import { SignedInPanel } from "../components/SignedInPanel";
import { ErrorState } from "../components/states/ErrorState";
import { LoadingState } from "../components/states/LoadingState";
import { useMe } from "../hooks/useMe";
import { isSupportedChainId } from "../lib/chains";

export function meta() {
  return [{ title: "BuyAnAnswer — Sign in" }];
}

export default function Home() {
  const me = useMe();

  if (me.isLoading) return <LoadingState message="Restoring your session…" />;
  if (me.isError) {
    return (
      <ErrorState
        title="Can't reach the server"
        message="The API isn't responding. Make sure it's running, then retry."
        onRetry={() => void me.refetch()}
      />
    );
  }
  if (me.data) return <SignedInPanel me={me.data} />;
  return <SignInFlow />;
}

/** Unauthenticated: walk connect → correct-network → sign-in. */
function SignInFlow() {
  const { isConnected, chainId } = useAccount();
  if (!isConnected) return <ConnectPanel />;
  if (!isSupportedChainId(chainId)) return <NetworkGuard />;
  return <SignInPanel />;
}
