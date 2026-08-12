// SPDX-License-Identifier: MIT
// The ask page at `/ask/:handle` (INTERACTIVE — sits under the `app-layout` wallet boundary, so wagmi
// hooks are available). It loads the creator's public board client-side, then hands off to the AskGate
// (session/connect/network/account gating) → the compose + pay flow. The "ask" prefix is a reserved
// handle on both sides (client + API), so it can never collide with a claimed board name.

import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { AskGate } from "../components/ask/AskGate";
import { EmptyState } from "../components/states/EmptyState";
import { ErrorState } from "../components/states/ErrorState";
import { LoadingState } from "../components/states/LoadingState";
import { LinkButton } from "../components/ui/LinkButton";
import { ApiError, getBoard } from "../lib/api";
import { validateHandle } from "../lib/handle";
import type { Route } from "./+types/ask";

export function meta({ params }: Route.MetaArgs) {
  const who = params.handle ? `@${params.handle}` : "a creator";
  return [{ title: `Ask ${who} — BuyAnAnswer` }];
}

function NotFound() {
  return (
    <EmptyState
      title="No creator here"
      message="This handle isn't claimed, so there's no one to ask. Check the link and try again."
      action={<LinkButton to="/">Go home</LinkButton>}
    />
  );
}

function AskLoader({ handle }: { handle: string }) {
  const board = useQuery({
    queryKey: ["board", handle],
    queryFn: () => getBoard(handle),
    retry: false,
  });

  if (board.isPending) return <LoadingState message="Loading…" />;
  if (board.isError) {
    if (board.error instanceof ApiError && board.error.status === 404) return <NotFound />;
    return (
      <ErrorState
        title="Can't reach the server"
        message="We couldn't load this creator. Please try again in a moment."
        onRetry={() => void board.refetch()}
      />
    );
  }
  return <AskGate creator={board.data} />;
}

export default function Ask() {
  const params = useParams();
  // A malformed/reserved handle can never be a real board (mirror of the server rule) → not found.
  const v = validateHandle(params.handle ?? "");
  if (!v.ok) return <NotFound />;
  return <AskLoader handle={v.handle} />;
}
