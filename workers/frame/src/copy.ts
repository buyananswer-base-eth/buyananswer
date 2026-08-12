// SPDX-License-Identifier: MIT
// User-facing frame copy — the plain-language money voice (ADR-0030): NO "escrow" jargon; say "held
// onchain", "you only pay for answers", "refunded if they don't", "take your money back". USDC / Base /
// onchain / wallet stay (crypto-native, fine). Button labels and frame titles pull from here so the
// voice is single-sourced and consistent with the web app + landing.

/** Format USDC base units (6-dp) as a compact display string, e.g. 2500000n → "2.5". */
export function formatUsdc(baseUnits: bigint): string {
  const whole = baseUnits / 1_000_000n;
  const frac = baseUnits % 1_000_000n;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

export const copy = {
  askTitle: (name: string) => `Ask ${name} — every tip buys a real answer`,
  askButton: (usdc: string) => `Ask · pay ${usdc} USDC`,
  openOnWeb: "Open on web",
  confirmTitle: "One more step — confirm to send your question",
  confirmButton: "Confirm & send",
  sentTitle: "Sent — your USDC is held onchain until they answer",
  sentButton: "View your question",
  notFoundTitle: "No creator here yet",
  goToSite: "Go to BuyAnAnswer",
  // Short hints shown as tx-endpoint error toasts (returned with a 400).
  needQuestion: "Type your question first, then tap Ask.",
  unknownCreator: "That creator isn't on BuyAnAnswer yet.",
  needWallet: "Connect a wallet in your Farcaster client to pay.",
  rejected: "Couldn't verify that action — please try again.",
  rateLimited: "You're going a little fast — give it a moment and try again.",
} as const;
