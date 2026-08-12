// SPDX-License-Identifier: MIT
// The live app frame: header (brand + wallet status + theme toggle), routed content, footer. Rendered
// only after the client-only Web3Provider mounts, so it can freely use wallet hooks.

import type { ReactNode } from "react";
import { Link } from "react-router";
import { ThemeToggle } from "./ThemeToggle";
import { WalletStatus } from "./WalletStatus";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <header className="app__header">
        <Link to="/app" className="brand">
          <span className="brand__dot" aria-hidden="true" />
          BuyAnAnswer
        </Link>
        <div className="app__header-actions">
          <WalletStatus />
          <ThemeToggle />
        </div>
      </header>
      <main className="app__main">{children}</main>
      <footer className="app__footer">Base · USDC · you only pay for answers</footer>
    </div>
  );
}
