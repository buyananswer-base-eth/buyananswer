// SPDX-License-Identifier: MIT
// Mini App runtime glue (ADR-0042). Client-only: imported from inside the Web3Provider boundary so
// SSR never touches the SDK.
//
// The one thing a Mini App MUST do is call `sdk.actions.ready()`. Until it does, the Farcaster
// client shows a splash screen over the app — so forgetting this call presents as "the Mini App
// hangs on the splash forever", with nothing in the console. It is called after mount, when the
// first paint has happened, so users never see a flash of an unstyled or empty app behind it.
//
// Everything else in the app is unchanged: inside a Mini App the user is an ordinary visitor with
// an injected wallet, so SIWE, the ask+pay flow and the indexer poll all work as they do on the web.

import { useEffect, useState } from "react";

/** Cached across hook instances — the host does not change during a session. */
let inMiniAppPromise: Promise<boolean> | undefined;

/**
 * True when running inside a Farcaster client's Mini App webview.
 *
 * Uses the SDK's own detection rather than sniffing the user agent or `window.parent`, because the
 * host surface differs across clients and platforms (web iframe vs native webview).
 */
export function detectMiniApp(): Promise<boolean> {
  if (!inMiniAppPromise) {
    inMiniAppPromise = import("@farcaster/miniapp-sdk")
      .then(({ sdk }) => sdk.isInMiniApp())
      .catch(() => false); // Not in a Mini App, or the SDK failed to load — behave as plain web.
  }
  return inMiniAppPromise;
}

/**
 * Dismiss the Farcaster splash screen once the app has rendered, and report whether we are in a
 * Mini App so the UI can adapt (e.g. hide a "connect wallet" step the host already handled).
 *
 * Safe to call on any page and outside Farcaster entirely: it no-ops when not in a Mini App.
 */
export function useMiniAppReady(): { isMiniApp: boolean; isResolved: boolean } {
  const [state, setState] = useState<{ isMiniApp: boolean; isResolved: boolean }>({
    isMiniApp: false,
    isResolved: false,
  });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const isMiniApp = await detectMiniApp();
      if (cancelled) return;
      setState({ isMiniApp, isResolved: true });
      if (!isMiniApp) return;

      try {
        const { sdk } = await import("@farcaster/miniapp-sdk");
        // Idempotent per the SDK; calling it twice (e.g. StrictMode double-effect) is harmless.
        await sdk.actions.ready();
      } catch {
        // A failed ready() leaves the splash up, which is bad but not worth crashing the app over —
        // the user can still close and reopen. Swallow rather than surface a wall of error text.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
