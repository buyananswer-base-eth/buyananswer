// SPDX-License-Identifier: MIT
// A single TanStack Query client for the app. Created lazily (client-only) and memoized so wagmi and
// our own `/me` query share one cache. Imported dynamically by the client-only Web3Provider.

import { QueryClient } from "@tanstack/react-query";

let client: QueryClient | undefined;

/** Get (or lazily create) the shared query client. */
export function getQueryClient(): QueryClient {
  if (!client) {
    client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          refetchOnWindowFocus: false,
          staleTime: 30_000,
        },
      },
    });
  }
  return client;
}
