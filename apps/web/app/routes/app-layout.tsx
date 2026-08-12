// SPDX-License-Identifier: MIT
// Layout route for the INTERACTIVE app (home / dashboard / onboarding / settings). It owns the
// client-only Web3 boundary + the wallet-aware app shell, so wallet libraries load ONLY for these
// routes. The public `/:handle` board is a sibling of this layout (see routes.ts) and therefore
// server-renders with no wagmi/query — the Session-10 requirement to make boards SSR-able.

import { Outlet } from "react-router";
import { AppShell } from "../components/AppShell";
import { Web3Provider } from "../providers/Web3Provider";

export default function AppLayout() {
  return (
    <Web3Provider>
      <AppShell>
        <Outlet />
      </AppShell>
    </Web3Provider>
  );
}
