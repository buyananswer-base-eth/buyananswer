// SPDX-License-Identifier: MIT
// The question detail + action route at `/questions/:id` (INTERACTIVE — under the `app-layout` wallet
// boundary, so wagmi is available for the settle txs). Reading is session-gated (SessionBoundary); the
// actions inside are additionally gated on a connected, matching wallet. `questions/:id` is two segments,
// so it never collides with the one-segment `:handle` board.

import { useParams } from "react-router";
import { SessionBoundary } from "../components/SessionBoundary";
import { QuestionDetail } from "../components/question/QuestionDetail";
import type { Route } from "./+types/question";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Question — BuyAnAnswer" }];
}

export default function Question() {
  const { id } = useParams();
  return <SessionBoundary>{(me) => <QuestionDetail id={id ?? ""} me={me} />}</SessionBoundary>;
}
