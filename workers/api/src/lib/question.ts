// SPDX-License-Identifier: MIT
// Question / answer presenters. The API surface deliberately shapes what leaves the Worker: list
// views never carry an answer body, and a detail view only includes the answer body when the paywall
// is open — i.e. the question is `answered` on-chain (indexer-written) OR the requester is the
// answerer (the creator can always see their own hidden draft). See FUNCTIONAL_SPEC §3.2/§3.3/§9.

import type { Answer, Question } from "@buyananswer/shared";

/** The full question record (no answer body). Money-state columns are echoed read-only. */
export function presentQuestion(q: Question) {
  return {
    id: q.id,
    chainId: q.chainId,
    onchainId: q.onchainId,
    askerWallet: q.askerWallet,
    answererWallet: q.answererWallet,
    amountUsdc: q.amountUsdc,
    body: q.body,
    status: q.status,
    answerDeadline: q.answerDeadline,
    isPublic: q.isPublic,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  };
}

/** A list item: the question plus whether a (hidden) answer has been drafted — never the body. */
export function presentQuestionListItem(q: Question, hasAnswer: boolean) {
  return { ...presentQuestion(q), hasAnswer };
}

/**
 * The answer sub-object for a detail view. `canSeeBody` is decided by the route (paywall). When the
 * body is withheld we still surface that an answer exists and its timestamps, but mark it `locked` so
 * the asker's UI can show "answer pending reveal" without leaking the text.
 */
export function presentAnswer(a: Answer, canSeeBody: boolean) {
  const base = {
    submittedAt: a.submittedAt,
    updatedAt: a.updatedAt,
    revealedAt: a.revealedAt,
  };
  return canSeeBody ? { ...base, body: a.body, locked: false } : { ...base, locked: true };
}

/** Detail view: the question plus a gated answer (`null` when no answer has been drafted yet). */
export function presentQuestionDetail(
  q: Question,
  answer: Answer | undefined,
  canSeeAnswerBody: boolean,
) {
  return {
    question: presentQuestion(q),
    answer: answer ? presentAnswer(answer, canSeeAnswerBody) : null,
  };
}
