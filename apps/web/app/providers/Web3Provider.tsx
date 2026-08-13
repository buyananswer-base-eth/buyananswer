// SPDX-License-Identifier: MIT
// Client-only Web3 boundary. wagmi/viem connectors are browser-only and would crash SSR, so we load
// wagmi, TanStack Query, and the wagmi config via DYNAMIC import inside an effect — they never enter
// the server bundle's execution path. Until they resolve (server render + first client render) we
// show the branded <AppSkeleton/>, so hydration matches exactly and the swap to the live tree happens
// after mount. This is the pattern the wallet/auth UI depends on (session brief: SSR + client-only).

import { type ReactNode, useEffect, useState } from "react";
import { AppSkeleton } from "../components/AppSkeleton";
import { detectMiniApp, useMiniAppReady } from "../hooks/useMiniApp";

type Runtime = {
  WagmiProvider: typeof import("wagmi")["WagmiProvider"];
  QueryClientProvider: typeof import("@tanstack/react-query")["QueryClientProvider"];
  config: import("wagmi").Config;
  queryClient: import("@tanstack/react-query").QueryClient;
};

export function Web3Provider({ children }: { children: ReactNode }) {
  const [runtime, setRuntime] = useState<Runtime | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      // Resolve the Farcaster host BEFORE building the config: the Mini App connector is only
      // safe to include when we are actually inside a Farcaster client (ADR-0044). Detection is
      // cached and failure-tolerant, so this costs one await and never blocks the open web.
      const [wagmi, reactQuery, { getWagmiConfig }, { getQueryClient }, inMiniApp] =
        await Promise.all([
          import("wagmi"),
          import("@tanstack/react-query"),
          import("../lib/wagmi"),
          import("../lib/query"),
          detectMiniApp(),
        ]);
      if (!active) return;
      setRuntime({
        WagmiProvider: wagmi.WagmiProvider,
        QueryClientProvider: reactQuery.QueryClientProvider,
        config: getWagmiConfig(inMiniApp),
        queryClient: getQueryClient(),
      });
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!runtime) return <AppSkeleton />;

  const { WagmiProvider, QueryClientProvider, config, queryClient } = runtime;
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <MiniAppReady />
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}

/**
 * Dismisses the Farcaster splash screen (ADR-0042). Renders nothing.
 *
 * Deliberately mounted INSIDE the runtime branch, i.e. only once the real tree has replaced
 * `<AppSkeleton/>`. Calling `ready()` while the skeleton is still up would hand the user a visibly
 * empty app. It no-ops outside a Farcaster client, so this is inert on the open web.
 */
function MiniAppReady() {
  useMiniAppReady();
  return null;
}
