// SPDX-License-Identifier: MIT
// The session query: `GET /me`. Because the session is a cookie (not wallet state), this resolves on
// load independently of wallet reconnection — which is what makes an authed session survive a refresh.
// Returns null (not an error) when unauthenticated, so callers branch on `data` for the signed-in vs
// signed-out states and on `isError` only for genuine server/network failures.

import { useQuery } from "@tanstack/react-query";
import { type Me, getMe } from "../lib/api";

export const ME_QUERY_KEY = ["me"] as const;

export function useMe() {
  return useQuery<Me | null>({
    queryKey: ME_QUERY_KEY,
    queryFn: () => getMe(),
    retry: false,
  });
}
