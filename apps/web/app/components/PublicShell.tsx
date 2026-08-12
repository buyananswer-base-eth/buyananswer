// SPDX-License-Identifier: MIT
// Public app frame for server-rendered pages (the `/:handle` board). Unlike AppShell it has NO wallet
// status — it renders without the client-only Web3 boundary, so boards SSR cleanly. Brand links home;
// the theme toggle is hydration-safe (renders during SSR).

import type { ReactNode } from "react";
import { Link } from "react-router";
import { ThemeToggle } from "./ThemeToggle";
import { LinkButton } from "./ui/LinkButton";

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <header className="app__header">
        <Link to="/" className="brand">
          <span className="brand__dot" aria-hidden="true" />
          BuyAnAnswer
        </Link>
        <div className="app__header-actions">
          <ThemeToggle />
          <LinkButton to="/app" size="sm">
            Enter App
          </LinkButton>
        </div>
      </header>
      <main className="app__main">{children}</main>
      <footer className="app__footer">Base · USDC · you only pay for answers</footer>
    </div>
  );
}
