// SPDX-License-Identifier: MIT
// Generate (once) and print the multi-actor TESTNET keyset the Session-17 harness drives the UI with.
//
//   node scripts/wallets.mjs             — create `.harness/wallets.json` if absent, print addresses
//   node scripts/wallets.mjs --force     — regenerate a brand-new keyset (old addresses are abandoned)
//   node scripts/wallets.mjs --balances  — also read each actor's Base Sepolia ETH + USDC balance
//
// One BIP-39 mnemonic, five HD accounts (m/44'/60'/0'/0/i) — so the whole keyset is one recoverable
// secret. The file is git-ignored (`e2e/.gitignore`) and written 0600. Keys are NEVER printed: this
// script prints roles + addresses + the amounts to fund, and nothing else. Testnet only — never fund
// these addresses on mainnet, and never reuse them for anything that holds real value.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { http, createPublicClient, formatEther, formatUnits, parseAbi, toHex } from "viem";
import { english, generateMnemonic, mnemonicToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const here = dirname(fileURLToPath(import.meta.url));
const e2eDir = join(here, "..");
const walletsPath = join(e2eDir, ".harness", "wallets.json");

/** The five actors the harness plays, in derivation order. Creators answer; askers pay. */
const ROLES = ["CREATOR_A", "CREATOR_B", "ASKER_1", "ASKER_2", "ASKER_3"];

/**
 * Gas float per actor, and testnet USDC per asker (creators never pay, so they need none). Base Sepolia
 * gas is ~0.006 gwei and the busiest actor spends well under 0.00001 ETH per full run, so 0.001 ETH is
 * hundreds of runs — no reason to drain a faucet for this.
 */
const FUND_ETH = "0.001";
const FUND_USDC_PER_ASKER = "5";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Circle testnet USDC on Base Sepolia
const erc20Abi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

/** Minimal `KEY=value` reader for `e2e/.env` (the harness's RPC/token live there; no dotenv dep). */
function envFromFile(key) {
  const path = join(e2eDir, ".env");
  if (!existsSync(path)) return undefined;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "");
  }
  return undefined;
}

function generate() {
  const mnemonic = generateMnemonic(english);
  const actors = {};
  ROLES.forEach((role, index) => {
    const account = mnemonicToAccount(mnemonic, { addressIndex: index });
    const privateKey = account.getHdKey().privateKey;
    if (!privateKey) throw new Error(`could not derive a private key for ${role}`);
    actors[role] = { index, address: account.address, privateKey: toHex(privateKey) };
  });
  return {
    note: "TESTNET ONLY — Base Sepolia. Git-ignored. Never fund on mainnet, never commit.",
    chainId: baseSepolia.id,
    createdAt: new Date().toISOString(),
    mnemonic,
    actors,
  };
}

function save(keyset) {
  mkdirSync(dirname(walletsPath), { recursive: true });
  writeFileSync(walletsPath, `${JSON.stringify(keyset, null, 2)}\n`, { mode: 0o600 });
  chmodSync(walletsPath, 0o600);
}

async function balances(keyset) {
  const rpcUrl = process.env.E2E_RPC_URL || envFromFile("E2E_RPC_URL");
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl || undefined) });
  const rows = [];
  for (const role of ROLES) {
    const address = keyset.actors[role].address;
    const [eth, usdc] = await Promise.all([
      client.getBalance({ address }),
      client.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      }),
    ]);
    rows.push({ role, eth: formatEther(eth), usdc: formatUnits(usdc, 6) });
  }
  return rows;
}

async function main() {
  const force = process.argv.includes("--force");
  const withBalances = process.argv.includes("--balances");

  let keyset;
  if (existsSync(walletsPath) && !force) {
    keyset = JSON.parse(readFileSync(walletsPath, "utf8"));
    console.log(
      `Using the existing keyset at e2e/.harness/wallets.json (created ${keyset.createdAt}).`,
    );
  } else {
    keyset = generate();
    save(keyset);
    console.log(
      `${force ? "Regenerated" : "Generated"} a new keyset → e2e/.harness/wallets.json (0600, git-ignored).`,
    );
  }

  const funded = withBalances ? await balances(keyset) : null;

  console.log("\nBase Sepolia (chain 84532) — fund these addresses:\n");
  const header = funded
    ? "ROLE        ADDRESS                                     FUND ETH  FUND USDC   HAS ETH      HAS USDC"
    : "ROLE        ADDRESS                                     FUND ETH  FUND USDC";
  console.log(header);
  for (const role of ROLES) {
    const isAsker = role.startsWith("ASKER");
    const usdcNeed = isAsker ? FUND_USDC_PER_ASKER : "—";
    const have = funded?.find((r) => r.role === role);
    const base = `${role.padEnd(11)} ${keyset.actors[role].address}  ${FUND_ETH.padEnd(8)}  ${usdcNeed.padEnd(9)}`;
    console.log(have ? `${base}  ${have.eth.slice(0, 10).padEnd(11)}  ${have.usdc}` : base);
  }

  console.log(`
Faucets
  ETH  — Coinbase Developer Platform / Alchemy / QuickNode Base Sepolia faucet
  USDC — https://faucet.circle.com (select "Base Sepolia")

Notes
  · Creators (CREATOR_A/B) need ETH for gas only — they never pay USDC.
  · Gas is the cheap part: the busiest actor spends <0.00001 ETH per full run, so ${FUND_ETH} ETH lasts
    hundreds of runs. USDC is the real budget — each asker escrows 1 USDC per question, so
    ${FUND_USDC_PER_ASKER} USDC covers ~4 full harness runs.
  · Platform fees accrue to the escrow's deployed feeAddress (the project keystore). The harness only
    asserts that it was credited — it never withdraws it.
  · The private keys stay in e2e/.harness/wallets.json (git-ignored, 0600) and are never printed.
`);
}

await main();
