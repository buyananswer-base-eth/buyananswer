// SPDX-License-Identifier: MIT
// Onboarding: the claim-handle step. Signed-out → the shared sign-in prompt (SessionBoundary). Already
// has a profile → straight to the editor. Otherwise → the claim form, which on success routes to the
// editor with the "copy your link" welcome banner.

import { Navigate } from "react-router";
import { SessionBoundary } from "../components/SessionBoundary";
import { ClaimHandleForm } from "../components/onboarding/ClaimHandleForm";

export function meta() {
  return [{ title: "BuyAnAnswer — Claim your handle" }];
}

export default function Onboarding() {
  return (
    <SessionBoundary>
      {(me) => (me.creator ? <Navigate to="/settings/profile" replace /> : <ClaimHandleForm />)}
    </SessionBoundary>
  );
}
