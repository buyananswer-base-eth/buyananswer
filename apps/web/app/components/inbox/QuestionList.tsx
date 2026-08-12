// SPDX-License-Identifier: MIT
// A paginated question list — the creator's received inbox (`kind="received"`) or the asker's history
// (`kind="asked"`). Newest-first, own-rows-only (the API scopes to the session wallet). Infinite "Load
// more" pagination over the API's limit/offset. Renders every async state: loading / error / empty / data.

import { useInfiniteQuery } from "@tanstack/react-query";
import { getAsked, getReceived } from "../../lib/api";
import { EmptyState } from "../states/EmptyState";
import { ErrorState } from "../states/ErrorState";
import { LoadingState } from "../states/LoadingState";
import { Button } from "../ui/Button";
import { QuestionRow } from "./QuestionRow";
import styles from "./inbox.module.css";

const PAGE_SIZE = 20;

const EMPTY_COPY: Record<"received" | "asked", { title: string; message: string }> = {
  received: {
    title: "No questions yet",
    message: "When someone pays to ask you a question, it lands here — answer it to get paid.",
  },
  asked: {
    title: "You haven't asked anything yet",
    message: "Find a creator's board and ask your first question — it'll show up here.",
  },
};

export function QuestionList({ kind }: { kind: "received" | "asked" }) {
  const query = useInfiniteQuery({
    queryKey: ["questions", kind],
    queryFn: ({ pageParam }) =>
      (kind === "received" ? getReceived : getAsked)({ limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.offset + lastPage.limit : undefined,
    retry: false,
  });

  if (query.isPending) return <LoadingState message="Loading questions…" />;
  if (query.isError) {
    return (
      <ErrorState
        title="Can't load questions"
        message="We couldn't reach the server. Please try again."
        onRetry={() => void query.refetch()}
      />
    );
  }

  const items = query.data.pages.flatMap((p) => p.questions);
  if (items.length === 0) {
    return <EmptyState title={EMPTY_COPY[kind].title} message={EMPTY_COPY[kind].message} />;
  }

  return (
    <div className={styles.list}>
      {items.map((item) => (
        <QuestionRow key={item.id} item={item} kind={kind} />
      ))}
      {query.hasNextPage ? (
        <div className={styles.loadMore}>
          <Button
            variant="secondary"
            isLoading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
