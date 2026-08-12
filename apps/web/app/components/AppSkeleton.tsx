// SPDX-License-Identifier: MIT
// The server-rendered / pre-hydration stand-in for the app. Rendered by Web3Provider until the
// client-only wallet runtime loads, so it must be static (no wallet/query/theme hooks) and match what
// hydration expects. Shares the app frame so the swap to the live shell is seamless.

import { Spinner } from "./ui/Spinner";

export function AppSkeleton() {
  return (
    <div className="app">
      <header className="app__header">
        <span className="brand">
          <span className="brand__dot" aria-hidden="true" />
          BuyAnAnswer
        </span>
      </header>
      <main className="app__main">
        <div style={{ display: "grid", placeItems: "center", minHeight: "40vh" }}>
          <Spinner size={28} label="Loading BuyAnAnswer" />
        </div>
      </main>
    </div>
  );
}
