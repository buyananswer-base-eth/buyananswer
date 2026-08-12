// SPDX-License-Identifier: MIT
// React Router v7 framework config (ADR-0025). SSR is left ON so Session 10 can server-render the
// public `/<handle>` boards + OG images (ADR-0013). Session 9's wallet/auth UI is wrapped in a
// client-only boundary (see app/providers/Web3Provider.tsx) so SSR never mounts browser-only wallet
// libraries. The Cloudflare Pages deploy adapter is wired at the Session-10 deploy step.

import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "app",
  ssr: true,
} satisfies Config;
