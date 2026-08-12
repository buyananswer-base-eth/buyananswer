// SPDX-License-Identifier: MIT
// Root document. The interactive app (wallet + auth) lives under the `app-layout` route, which owns
// the client-only Web3Provider; the public `/:handle` board is a sibling that server-renders without
// wallet libraries. So the root just provides the HTML document + a plain <Outlet>. A tiny inline
// script applies the saved theme before paint to avoid a flash.

import type { ReactNode } from "react";
import {
  Links,
  type LinksFunction,
  Meta,
  type MetaFunction,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from "react-router";
import { ErrorState } from "./components/states/ErrorState";
import appHref from "./styles/app.css?url";
import tokensHref from "./styles/tokens.css?url";

export const links: LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  { rel: "manifest", href: "/site.webmanifest" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    // Bricolage Grotesque (display) + Inter (UI/body). `display=swap` so text never blocks paint;
    // the token fallbacks (system-ui) render instantly if the CDN is slow.
    href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Inter:wght@400;500;600;700&display=swap",
  },
  { rel: "stylesheet", href: tokensHref },
  { rel: "stylesheet", href: appHref },
];

export const meta: MetaFunction = () => [
  { title: "BuyAnAnswer" },
  { name: "description", content: "Your link in bio, but every tip buys a real answer." },
];

// Apply the persisted theme before first paint (no flash). Only 'dark'/'light' are honored; anything
// else falls through to the OS `prefers-color-scheme`.
const THEME_INIT =
  "try{var t=localStorage.getItem('ba-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;}catch(e){}";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#faf8f1" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0e0d0a" media="(prefers-color-scheme: dark)" />
        <Meta />
        <Links />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static, no user input — pre-paint theme. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  let title = "Unexpected error";
  let message = "Something went wrong. Please reload the page.";
  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`;
    message = error.status === 404 ? "That page doesn't exist." : message;
  } else if (error instanceof Error) {
    message = error.message;
  }
  return (
    <main className="app__main">
      <ErrorState title={title} message={message} />
    </main>
  );
}
