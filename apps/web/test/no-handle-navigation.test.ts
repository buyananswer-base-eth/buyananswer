// SPDX-License-Identifier: MIT
// Session 19 — named regression: A SIGNED-IN USER WITHOUT A HANDLE IS NOT DEAD-ENDED.
//
// THE BUG THIS PINS: /dashboard has always rendered "Questions you asked" and the withdrawable
// balance OUTSIDE the `me.creator` branch, deliberately — an asker needn't be a creator, and the
// fee wallet is not a creator at all. But `SignedInPanel` offered a user with no profile exactly
// one link, "Claim your handle" → /onboarding. So the dashboard was correct and simultaneously
// unreachable: an asker could not see a question they had paid for, and the fee address could not
// withdraw, without hand-typing the URL. There is no nav bar in the app layout, so per-panel links
// are the ONLY navigation.
//
// Nothing failed. Every unit test passed, every route rendered, the API returned the right data.
// The defect lived in the space between correct pieces, which is exactly the kind a type checker
// and a route-level test cannot see.
//
// This asserts the source of the two panels rather than rendering them: the components pull in the
// wagmi/React tree, and the property that actually regressed is "does a no-profile user get offered
// a route to /dashboard", which is a question about the JSX, not about runtime behaviour.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

const signedInPanel = read("app/components/SignedInPanel.tsx");
const dashboard = read("app/routes/dashboard.tsx");

/** The JSX branch rendered when `me.creator` is falsy — everything after the `) : (` of that ternary. */
function noCreatorBranch(source: string): string {
  const idx = source.indexOf("me.creator ?");
  expect(idx, "expected a `me.creator ?` ternary").toBeGreaterThan(-1);
  const rest = source.slice(idx);
  const elseIdx = rest.indexOf(") : (");
  expect(elseIdx, "expected an else branch").toBeGreaterThan(-1);
  return rest.slice(elseIdx);
}

describe("regression: a signed-in user with no handle can still reach their money", () => {
  it("SignedInPanel offers a route to /dashboard when there is no creator profile", () => {
    const branch = noCreatorBranch(signedInPanel);
    expect(branch).toContain("/onboarding"); // claiming stays the primary action
    expect(
      branch.includes('to="/dashboard"'),
      "a user without a handle must still be offered the dashboard — that is where their asked " +
        "questions and withdrawable balance live",
    ).toBe(true);
  });

  it("does not frame claiming a handle as a prerequisite", () => {
    // "One step left" told askers and the fee wallet they were mid-signup when they were not.
    expect(signedInPanel).not.toContain("One step left");
  });

  it("the dashboard renders the asked history OUTSIDE the creator branch", () => {
    // Both must sit after the received-inbox ternary closes, i.e. unconditionally.
    const askedIdx = dashboard.indexOf('kind="asked"');
    const receivedIdx = dashboard.indexOf('kind="received"');
    expect(askedIdx).toBeGreaterThan(-1);
    expect(receivedIdx).toBeGreaterThan(-1);
    // The received list is creator-gated; the asked list must NOT be inside that same ternary.
    const between = dashboard.slice(receivedIdx, askedIdx);
    expect(between).toContain(") : null}");
  });

  it("the dashboard renders WithdrawCard unconditionally", () => {
    const withdrawIdx = dashboard.indexOf("<WithdrawCard />");
    expect(withdrawIdx).toBeGreaterThan(-1);
    // Nothing between the asked section and the withdraw card may re-open a creator ternary.
    const tail = dashboard.slice(dashboard.indexOf('kind="asked"'), withdrawIdx);
    expect(tail).not.toContain("me.creator ?");
  });
});
