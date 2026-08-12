// SPDX-License-Identifier: MIT
// Vite config for the web app. The dev server proxies `/api/*` to the local API Worker so the
// browser and the API share ONE origin (http://localhost:5173). That is what makes the API's
// HttpOnly/Secure/SameSite=Lax `ba_session` cookie (ADR-0022) usable from the SPA, and it makes the
// SIWE `domain` the API binds (the request Host) equal `window.location.host`. `changeOrigin: false`
// keeps the browser's Host header intact through the proxy so that binding holds. Run the API with
// `pnpm --filter @buyananswer/api dev` (wrangler dev on :8787) alongside `pnpm --filter web dev`.

import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

const API_PROXY_TARGET = process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8787";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: API_PROXY_TARGET,
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      // Avatar objects are served by the API Worker at `/avatars/*` (the fallback when no public bucket
      // URL is set). Proxy them so an avatar URL the API minted against the dev host resolves same-origin.
      "/avatars": {
        target: API_PROXY_TARGET,
        changeOrigin: false,
      },
    },
  },
  // The SSR bundle targets the CLOUDFLARE WORKERS runtime, not Node (ADR-0038). Resolving with the
  // `worker` condition is what makes `react-dom/server` map to `server.browser.js` — the build that
  // exports `renderToReadableStream` (Web Streams). The Node build (`server.node.js`) exports only
  // `renderToPipeableStream` and pulls in `node:stream`, which workerd cannot run. `app/entry.server.tsx`
  // depends on this condition; changing it back breaks the deploy, not just the types.
  ssr: {
    resolve: {
      conditions: ["worker", "browser"],
    },
    // Bundle everything into the Worker — workerd has no node_modules to resolve at runtime.
    noExternal: true,
  },
  plugins: [reactRouter()],
});
