// SPDX-License-Identifier: MIT
// The run report. Playwright's HTML report says which specs passed; this says what happened to the
// MONEY — per path, per actor, with the transaction hashes and the USDC deltas — which is the thing a
// pre-deploy dry run has to be able to show. Printed to the console at the end of the run and written
// to `.harness/last-run.json` (git-ignored).

import { mkdirSync, writeFileSync } from "node:fs";
import { formatUnits } from "viem";
import { HARNESS_DIR, RESULTS_PATH } from "./env";

export type PathStatus = "pass" | "fail" | "skip";

export interface PathRow {
  name: string;
  status: PathStatus;
  notes: string[];
}

export interface TxRow {
  label: string;
  hash: string;
}

export interface BalanceRow {
  role: string;
  address: string;
  before: bigint;
  after?: bigint;
}

const paths: PathRow[] = [];
const txs: TxRow[] = [];
const balances = new Map<string, BalanceRow>();
const extras: string[] = [];

export function recordPath(name: string, status: PathStatus, notes: string[] = []): void {
  paths.push({ name, status, notes });
}

export function recordTx(label: string, hash: string | null | undefined): void {
  if (hash) txs.push({ label, hash });
}

export function recordBalanceBefore(role: string, address: string, before: bigint): void {
  balances.set(role, { role, address, before });
}

export function recordBalanceAfter(role: string, after: bigint): void {
  const row = balances.get(role);
  if (row) row.after = after;
}

/** A free-form line for the summary (solvency, fee credit, the reclaim deadline, …). */
export function note(line: string): void {
  extras.push(line);
}

const signed = (base: bigint): string =>
  `${base >= 0n ? "+" : "-"}${formatUnits(base < 0n ? -base : base, 6)}`;

const MARK: Record<PathStatus, string> = { pass: "PASS", fail: "FAIL", skip: "SKIP" };

/** Render the whole run as plain text (also the thing pasted into the session write-up). */
export function formatReport(): string {
  const lines: string[] = [
    "",
    "── BuyAnAnswer harness — Base Sepolia live run ──────────────────────",
    "",
  ];

  lines.push("Paths");
  for (const p of paths) {
    lines.push(`  [${MARK[p.status]}] ${p.name}`);
    for (const n of p.notes) lines.push(`         ${n}`);
  }

  if (balances.size > 0) {
    lines.push("", "USDC deltas (wallet balances, base units → USDC)");
    for (const row of balances.values()) {
      const delta = row.after !== undefined ? signed(row.after - row.before) : "—";
      const after = row.after !== undefined ? formatUnits(row.after, 6) : "—";
      lines.push(
        `  ${row.role.padEnd(11)} ${row.address}  ${formatUnits(row.before, 6).padStart(10)} → ${after.padStart(10)}  (${delta})`,
      );
    }
  }

  if (txs.length > 0) {
    lines.push("", "Transactions (sepolia.basescan.org/tx/…)");
    for (const t of txs) lines.push(`  ${t.label.padEnd(34)} ${t.hash}`);
  }

  if (extras.length > 0) {
    lines.push("", "Checks");
    for (const e of extras) lines.push(`  ${e}`);
  }

  lines.push("");
  return lines.join("\n");
}

/** Persist the raw report next to the keyset (git-ignored) and return the printable text. */
export function saveReport(): string {
  const text = formatReport();
  mkdirSync(HARNESS_DIR, { recursive: true });
  writeFileSync(
    RESULTS_PATH,
    `${JSON.stringify(
      {
        paths,
        txs,
        balances: [...balances.values()].map((b) => ({
          ...b,
          before: b.before.toString(),
          after: b.after?.toString() ?? null,
        })),
        checks: extras,
      },
      null,
      2,
    )}\n`,
  );
  return text;
}
