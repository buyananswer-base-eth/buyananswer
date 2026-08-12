// SPDX-License-Identifier: MIT
// Server render entry — CLOUDFLARE WORKERS runtime (ADR-0038).
//
// This replaces the original Node preset entry (`node:stream` + `renderToPipeableStream`), which
// workerd cannot run. It uses Web Streams via `renderToReadableStream`, which reaches us because
// `vite.config.ts` resolves the SSR build with the `worker` condition — that maps
// `react-dom/server` to `server.browser.js`. Both halves are required; neither works alone.
//
// Minimal streaming render without `isbot` — we always stream the same shell. The whole interactive
// app lives behind a client-only boundary (Web3Provider), so the server render is a lightweight
// branded skeleton and never touches wallet libraries.

import { renderToReadableStream } from "react-dom/server";
import type { EntryContext } from "react-router";
import { ServerRouter } from "react-router";

/** Hard cap on how long a render may stream before we give up (matches the previous Node entry). */
const ABORT_DELAY = 10_000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
): Promise<Response> {
  let statusCode = responseStatusCode;
  let shellRendered = false;

  // Abort a render that overruns, and tie it to client disconnects so a cancelled request does not
  // keep the isolate busy.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ABORT_DELAY);
  request.signal.addEventListener("abort", () => controller.abort());

  const stream = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      signal: controller.signal,
      onError(error: unknown) {
        // Errors thrown before the shell flushes are rethrown by renderToReadableStream below and
        // become a 500. After the shell has flushed the status is already sent, so we can only log.
        statusCode = 500;
        if (shellRendered) console.error(error);
      },
    },
  );

  shellRendered = true;
  // Release the timer once the stream finishes either way, so it never outlives the response.
  stream.allReady.then(
    () => clearTimeout(timeout),
    () => clearTimeout(timeout),
  );

  responseHeaders.set("Content-Type", "text/html");
  return new Response(stream, { headers: responseHeaders, status: statusCode });
}
