// SPDX-License-Identifier: MIT
// Client-side session gate for the interactive creator screens. Renders the shared loading / server-
// error / signed-out states from the cookie-backed `/me` query, then hands the resolved session to its
// render-prop child. Gating here is purely UX — the API enforces authorization server-side on every
// mutation, which is where access control actually lives.

import type { ReactNode } from "react";
import { useMe } from "../hooks/useMe";
import type { Me } from "../lib/api";
import { EmptyState } from "./states/EmptyState";
import { ErrorState } from "./states/ErrorState";
import { LoadingState } from "./states/LoadingState";
import { LinkButton } from "./ui/LinkButton";

export function SessionBoundary({ children }: { children: (me: Me) => ReactNode }) {
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
  if (!me.data) {
    return (
      <EmptyState
        title="Sign in required"
        message="Connect your wallet and sign in to continue."
        action={<LinkButton to="/app">Go to sign in</LinkButton>}
      />
    );
  }
  return <>{children(me.data)}</>;
}
