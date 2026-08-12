// SPDX-License-Identifier: MIT
// Client hydration entry. Kept explicit (rather than the framework default) so we don't pull in the
// default entry's `isbot` dependency — Session 9 has no bot-vs-human render branch.

import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
