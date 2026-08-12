// SPDX-License-Identifier: MIT
// Regenerates src/contracts/escrowAbi.ts from the Foundry build output so the ABI shipped to
// workers/sdk/web can never drift from the compiled contract. Run AFTER `forge build`.
//
//   pnpm --filter @buyananswer/shared gen:contracts
//
// It reads only the `abi` field from contracts/out (git-ignored build output) and emits a typed,
// `as const` TypeScript module (committed) — no addresses or secrets are involved here.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const artifactPath = resolve(
  repoRoot,
  "contracts/out/BuyAnAnswerEscrow.sol/BuyAnAnswerEscrow.json",
);
const outPath = resolve(here, "../src/contracts/escrowAbi.ts");

let raw;
try {
  raw = readFileSync(artifactPath, "utf8");
} catch {
  console.error(
    `\n[gen:contracts] Could not read ${artifactPath}\nRun \`forge build\` in contracts/ first (the out/ directory is git-ignored).\n`,
  );
  process.exit(1);
}

const { abi } = JSON.parse(raw);
if (!Array.isArray(abi) || abi.length === 0) {
  console.error("[gen:contracts] Foundry artifact has no `abi` array.");
  process.exit(1);
}

const banner = `// SPDX-License-Identifier: MIT
// GENERATED FILE — do not edit by hand.
// Source: contracts/out/BuyAnAnswerEscrow.sol/BuyAnAnswerEscrow.json (solc 0.8.28, cancun).
// Regenerate: \`forge build\` in contracts/, then
//   pnpm --filter @buyananswer/shared gen:contracts

`;

const body = `/** ABI of \`BuyAnAnswerEscrow\`, derived from the compiled contract. */
export const buyAnAnswerEscrowAbi = ${JSON.stringify(abi, null, 2)} as const;
`;

writeFileSync(outPath, banner + body);
console.log(`[gen:contracts] Wrote ${abi.length} ABI entries → ${outPath}`);
